import { spawn } from "node:child_process";
import type { Stats } from "node:fs";
import {
  access,
  cp,
  lstat,
  mkdir,
  readdir,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { writeAppConfig } from "@morlay/dsh-desktop-shell/appconfig";
import { syncProfileBundles } from "./dev-web.ts";
import {
  DSH_PACKAGE,
  desktopHost,
  officialDependencySpecs,
  resolveOfficialPackage,
  toolModulesDir,
  type OfficialResolutionInput,
} from "./official-deps.ts";
import { DESKTOP_HOST_PACKAGE } from "@morlay/dsh-desktop-shell/official";
import { buildShell, SHELL_ENTRY, SHELL_PACKAGE_ROOT } from "./shell.ts";
import {
  PROFILE_NAME,
  buildRoot,
  desktopConfig,
  dshVersion as readDshVersion,
  findWorkspaceRoot,
  mergedProfileBundles,
  resolveDevHome,
  resolveWorkspace,
  workspaceManifest,
  type ResolvedWorkspaceManifest,
} from "./workspace.ts";

const APP_ROOT = resolve(import.meta.dirname, "..", "..");
function debugPort(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`desktop development: ${name} must be an integer from 1 through 65535`);
  }
  return port;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function officialInput(
  workspace: string,
  workspaceRoot: string,
  manifest: ResolvedWorkspaceManifest,
): OfficialResolutionInput {
  const dshVersion = readDshVersion(manifest);
  return {
    workspace,
    workspaceRoot,
    toolRoot: APP_ROOT,
    ...(dshVersion === undefined ? {} : { dshVersion }),
  };
}

async function cliEntry(input: OfficialResolutionInput): Promise<string> {
  const dsh = await resolveOfficialPackage(DSH_PACKAGE, input);
  if (dsh === undefined) {
    throw new Error(`desktop development: cannot resolve ${DSH_PACKAGE}`);
  }
  // dev 形态跑上游 CLI 的**源码**入口：`@deepseek-ai/*` 经 exports 指到 src 后运行期没有 lib 产物，
  // 转译与装饰器降级由注入的 TS loader 承担。
  return join(dsh.dir, "src", "bin.ts");
}

// dev 形态给子进程注入的 TS loader：`@local/devkit` 的 oxc loader（转译 + legacy 装饰器降级）。
// 上游包经 exports 指到 src 后，Node 原生 strip-only 不支持 parameter properties / enum / 装饰器。
function tsLoaderSpecifier(): string {
  return import.meta.resolve("@local/devkit/ts-loader");
}

function withTsLoader(environment: NodeJS.ProcessEnv, loader: string): NodeJS.ProcessEnv {
  return {
    ...environment,
    NODE_OPTIONS: [environment.NODE_OPTIONS, `--import=${loader}`].filter(Boolean).join(" "),
  };
}

async function run(
  command: string,
  args: readonly string[],
  cwd: string,
  environment = process.env,
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env: environment, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else
        reject(
          new Error(`desktop development: ${args.join(" ")} exited with ${String(code ?? signal)}`),
        );
    });
  });
}

async function removeOwnedPath(path: string): Promise<void> {
  let stat: Stats;
  try {
    stat = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (stat.isSymbolicLink()) {
    await unlink(path);
    return;
  }
  if (stat.isDirectory()) {
    await rm(path, { recursive: true });
    return;
  }
  await unlink(path);
}

async function linkDirectory(
  source: string,
  destination: string,
  skipExisting = false,
): Promise<void> {
  if (skipExisting) {
    try {
      await lstat(destination);
      return;
    } catch {}
  }
  await mkdir(dirname(destination), { recursive: true });
  await symlink(
    await realpath(source),
    destination,
    process.platform === "win32" ? "junction" : "dir",
  );
}

async function mirrorDependencyLinks(
  sourceRoot: string,
  destinationRoot: string,
  skipExisting = false,
): Promise<void> {
  for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const source = join(sourceRoot, entry.name);
    if (entry.name.startsWith("@") && (entry.isDirectory() || entry.isSymbolicLink())) {
      await mkdir(join(destinationRoot, entry.name), { recursive: true });
      for (const scoped of await readdir(source, { withFileTypes: true })) {
        if (!scoped.isDirectory() && !scoped.isSymbolicLink()) continue;
        await mirrorOneLink(
          join(source, scoped.name),
          join(destinationRoot, entry.name, scoped.name),
          skipExisting,
        );
      }
      continue;
    }
    if (entry.isDirectory() || entry.isSymbolicLink())
      await mirrorOneLink(source, join(destinationRoot, entry.name), skipExisting);
  }
}

async function mirrorOneLink(
  source: string,
  destination: string,
  skipExisting: boolean,
): Promise<void> {
  if (!(await pathExists(source))) return;
  await linkDirectory(source, destination, skipExisting);
}

async function prepareDevelopmentProject(
  projectDir: string,
  workspace: string,
  input: OfficialResolutionInput,
): Promise<string> {
  const manifest = await workspaceManifest(workspace);
  const dsh = await resolveOfficialPackage(DSH_PACKAGE, input);
  const host = await desktopHost();
  if (dsh === undefined) throw new Error(`desktop development: cannot resolve ${DSH_PACKAGE}`);
  if (host === undefined) {
    throw new Error(
      `desktop development: bundled ${DESKTOP_HOST_PACKAGE} is missing; run the tool build (pnpm build)`,
    );
  }

  const virtualStore = join(input.workspaceRoot, "node_modules", ".pnpm", "node_modules");
  const workspaceDependencyDir = (await pathExists(virtualStore))
    ? virtualStore
    : join(workspace, "node_modules");
  if (!(await pathExists(workspaceDependencyDir))) {
    throw new Error(
      `desktop development: workspace dependency links are missing under ${workspaceDependencyDir}; run pnpm install`,
    );
  }
  if (!(await pathExists(join(host.dir, "lib", "index.js")))) {
    throw new Error(
      `desktop development: ${DESKTOP_HOST_PACKAGE} is not built (${join(host.dir, "lib", "index.js")} is missing)`,
    );
  }
  const officialDependencies = await officialDependencySpecs(input);
  await removeOwnedPath(projectDir);
  await mkdir(projectDir, { recursive: true });
  await writeFile(
    join(projectDir, "package.json"),
    `${JSON.stringify(
      {
        name: manifest.name,
        private: true,
        version: "0.0.0",
        dependencies: officialDependencies,
        dsh: { profile: { bundles: mergedProfileBundles(manifest) } },
      },
      undefined,
      2,
    )}\n`,
  );
  const destinationModules = join(projectDir, "node_modules");
  await mkdir(destinationModules, { recursive: true });
  await mirrorDependencyLinks(workspaceDependencyDir, destinationModules);

  const toolStore = await toolModulesDir(input);
  if (toolStore !== undefined && resolve(toolStore) !== resolve(workspaceDependencyDir)) {
    await mirrorDependencyLinks(toolStore, destinationModules, true);
  }
  const dshLink = join(destinationModules, "@deepseek-ai", "dsh");
  await removeOwnedPath(dshLink);
  await copyPackage(dsh.dir, dshLink);
  const hostLink = join(destinationModules, ...DESKTOP_HOST_PACKAGE.split("/"));
  await removeOwnedPath(hostLink);
  await copyPackage(host.dir, hostLink);
  return projectDir;
}

async function copyPackage(source: string, destination: string): Promise<void> {
  await cp(source, destination, {
    recursive: true,
    dereference: true,

    filter: (entry) => {
      const rel = relative(source, entry);
      return rel === "" || !rel.split(/[\\/]/u).includes("node_modules");
    },
  });
}

async function prepareWebProfile(
  workspace: string,
  input: OfficialResolutionInput,
  home: string,
  tsLoader: string,
): Promise<string> {
  const manifest = await workspaceManifest(workspace);
  const entry = await cliEntry(input);
  if (!(await pathExists(entry))) {
    throw new Error(`desktop development: missing source entry ${entry}`);
  }
  const environment = withTsLoader({ ...process.env, DSH_HOME: home }, tsLoader);
  const dependencies = Object.keys(manifest.dependencies ?? {});
  for (const packageName of dependencies) {
    const link = resolveLinkTarget(workspace, packageName);
    await run(
      process.execPath,
      [entry, "plugin", "--profile", "web", "add", `${packageName}@link:${link}`],
      workspace,
      { ...environment, DSH_HOME: home },
    );
  }
  const profileDir = join(home, "profiles", "web");
  // 装配清单归 app 定义：profile 里那份是种子时写的，不跟随后来的改动，而 patch 层顺序按它排。
  await syncProfileBundles(profileDir, mergedProfileBundles(manifest));
  return profileDir;
}

function resolveLinkTarget(workspace: string, packageName: string): string {
  const require = createRequire(join(workspace, "package.json"));
  const resolved = require.resolve(packageName);

  const marker = `${sep}src${sep}index`;
  const boundary = resolved.indexOf(marker);
  return boundary < 0 ? dirname(dirname(resolved)) : resolved.slice(0, boundary);
}

async function launchElectron(
  projectDir: string,
  buildRootDir: string,
  tsLoader: string,
  home: string,
): Promise<void> {
  const require = createRequire(import.meta.url);
  const electron: unknown = require("electron");
  if (typeof electron !== "string")
    throw new Error("desktop development: electron executable is unavailable");
  const mainPort = debugPort("DSH_DESKTOP_MAIN_INSPECT_PORT", 9229);
  const rendererPort = debugPort("DSH_DESKTOP_RENDERER_DEBUG_PORT", 9222);
  // 9231 而不是 9230：那是上游 `experimental-inspector` 的 Worker 默认端口，桌面档装着那条行时
  // 两者会抢同一个端口，抢输的是整条 inspector 行（Worker 起不来 → 行回滚）。
  const hostPort = debugPort("DSH_DESKTOP_HOST_INSPECT_PORT", 9231);
  const developmentRoot = join(buildRootDir, "development");
  // 数据面与 `dev --web` 共用工作区 store；只有浏览器数据留在构建目录里。
  const userData = join(developmentRoot, "electron-user-data");

  const systemNode = process.env.DSH_DESKTOP_NODE_BINARY ?? process.env.npm_node_execpath ?? "node";
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    DSH_HOME: home,
    DSH_DESKTOP_APPCONFIG_DIR: join(buildRootDir, "runtime"),
    DSH_DESKTOP_DEV_PROJECT_DIR: projectDir,
    DSH_DESKTOP_HOST_INSPECT_PORT: String(hostPort),
    DSH_DESKTOP_NODE_BINARY: systemNode,

    DSH_DESKTOP_SOURCE_LOADER: tsLoader,
    DSH_DESKTOP_OPEN_DEVTOOLS: process.env.DSH_DESKTOP_OPEN_DEVTOOLS ?? "1",
    ELECTRON_ENABLE_LOGGING: process.env.ELECTRON_ENABLE_LOGGING ?? "1",
  };
  console.log(`desktop development: DSH_HOME=${home}`);
  console.log(
    `desktop development: inspectors main=${String(mainPort)}, renderer=${String(rendererPort)}, host=${String(hostPort)}`,
  );
  await run(
    electron,
    [
      `--inspect=127.0.0.1:${String(mainPort)}`,
      `--remote-debugging-port=${String(rendererPort)}`,
      `--user-data-dir=${userData}`,
      SHELL_PACKAGE_ROOT,
    ],
    SHELL_PACKAGE_ROOT,
    environment,
  );
}

export interface DevOptions {
  readonly workspace?: string;
  readonly web: boolean;
  // 数据面根；缺省是工作区内的 `.dsh-store`，取值语义见 `resolveDevHome`。
  readonly home?: string;
}

export async function runDev(options: DevOptions): Promise<void> {
  const workspace = resolve(options.workspace ?? resolveWorkspace());
  const repositoryRoot = await findWorkspaceRoot(workspace);
  const manifest = await workspaceManifest(workspace);
  const input = officialInput(workspace, repositoryRoot, manifest);
  const buildRootDir = buildRoot(workspace);
  // 两种 dev 形态共用同一个数据面根；`--home=xdg` 时与打包形态落到同一个目录。
  const home = resolveDevHome(workspace, manifest.name, options.home);
  await buildShell();
  const tsLoader = tsLoaderSpecifier();
  if (options.web) {
    const profileDir = await prepareWebProfile(workspace, input, home, tsLoader);
    const port = process.env.PORT ?? "3080";
    const entry = await cliEntry(input);
    if (!(await pathExists(entry))) {
      throw new Error(`desktop development: missing source entry ${entry}`);
    }
    console.log(
      `desktop development: web mode DSH_HOME=${home} profile=${profileDir} port=${port}`,
    );

    const environment = { ...process.env, DSH_HOME: home };
    await run(
      process.execPath,
      [entry, "web", "--port", port],
      repositoryRoot,
      withTsLoader(environment, tsLoader),
    );
    return;
  }
  if (!(await pathExists(SHELL_ENTRY))) {
    throw new Error(`desktop development: missing built artifact ${SHELL_ENTRY}`);
  }
  const projectDir = await prepareDevelopmentProject(
    join(buildRootDir, "development", "project"),
    workspace,
    input,
  );
  const desktop = desktopConfig(manifest);
  const runtimeRoot = join(buildRootDir, "runtime");
  await mkdir(runtimeRoot, { recursive: true });
  await writeAppConfig(runtimeRoot, {
    name: manifest.name,
    displayName: desktop.displayName,
    id: desktop.id,
    version: desktop.version,
    dshHome: home,
    window: desktop.window,
    profile: PROFILE_NAME,
  });

  await launchElectron(projectDir, buildRootDir, tsLoader, home);
}
