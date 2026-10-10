import { spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeAppConfig } from "@morlay/dsh-desktop-shell/appconfig";
import { DESKTOP_HOST_PACKAGE } from "@morlay/dsh-desktop-shell/official";
import { devRuntimeRoot, requireDevRuntime } from "./dev-layout.ts";
import { buildShell, SHELL_ENTRY, SHELL_PACKAGE_ROOT } from "./shell.ts";
import {
  PROFILE_NAME,
  buildRoot,
  desktopConfig,
  findWorkspaceRoot,
  resolveDevHome,
  resolveWorkspace,
  workspaceManifest,
} from "./workspace.ts";

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

// web 形态的启动入口住在宿主变体包里（同一套 app-boot）；dev 形态从工作区解析它。
async function webEntry(): Promise<string> {
  const hostRoot = dirname(
    fileURLToPath(import.meta.resolve(`${DESKTOP_HOST_PACKAGE}/package.json`)),
  );
  const entry = join(hostRoot, "src", "web.ts");
  if (!(await pathExists(entry))) {
    throw new Error(`desktop development: missing ${entry}; run the tool build (pnpm build)`);
  }
  return entry;
}

// 源码 client 半「现场打包」那条行的定义只有一份：宿主包里的 overlay（它按相对路径指自己的 `lib/`）。
// 桌面形态由宿主自己挂；web 形态的 profile 就是 app 目录，宿主那层拿不到，所以这里按 `--patch` 挂上。
async function devClientPatch(): Promise<string> {
  const hostRoot = dirname(
    fileURLToPath(import.meta.resolve(`${DESKTOP_HOST_PACKAGE}/package.json`)),
  );
  const patch = join(hostRoot, "config", "dev-client-bundles.cordis.patch.yml");
  if (!(await pathExists(patch)))
    throw new Error(`desktop development: missing ${patch}; run the tool build (pnpm build)`);
  return patch;
}

async function launchElectron(
  profileDir: string,
  runtimeDir: string,
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
    // 两格分工：`PROFILE_DIR` 是 profile root（app 目录本身），`RUNTIME_DIR` 是安装根
    // （官方闭包、前端产物与 host 载荷的来源）。
    DSH_DESKTOP_DEV_PROFILE_DIR: profileDir,
    DSH_DESKTOP_DEV_RUNTIME_DIR: runtimeDir,
    DSH_DESKTOP_HOST_INSPECT_PORT: String(hostPort),
    DSH_DESKTOP_NODE_BINARY: systemNode,

    DSH_DESKTOP_SOURCE_LOADER: tsLoader,
    DSH_DESKTOP_OPEN_DEVTOOLS: process.env.DSH_DESKTOP_OPEN_DEVTOOLS ?? "1",
    ELECTRON_ENABLE_LOGGING: process.env.ELECTRON_ENABLE_LOGGING ?? "1",
  };
  console.log(`desktop development: DSH_HOME=${home}`);
  console.log(`desktop development: profile root=${profileDir} runtime=${runtimeDir}`);
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
  const buildRootDir = buildRoot(workspace);
  // 两种 dev 形态共用同一个数据面根；`--home=xdg` 时与打包形态落到同一个目录。
  const home = resolveDevHome(workspace, manifest.name, options.home);
  const runtimeDir = devRuntimeRoot(repositoryRoot);
  await requireDevRuntime(runtimeDir);
  await buildShell();
  const tsLoader = tsLoaderSpecifier();

  if (options.web) {
    // web 形态的 profile 就是 app 目录：清单来自 app 的 `package.json`，bundle 由工作区链接解析，
    // 因此没有 `plugin add`、也没有 `$DSH_HOME/profiles/web`。端口契约（`PORT`，缺省 3080）与
    // 内层参数归 web 入口：它把 `--` 之后原样交给 web app 的 flag family。
    console.log(`desktop development: web mode DSH_HOME=${home} profile root=${workspace}`);
    await run(
      process.execPath,
      [
        await webEntry(),
        "--profile-dir",
        workspace,
        "--runtime-dir",
        runtimeDir,
        "--patch",
        await devClientPatch(),
      ],
      repositoryRoot,
      withTsLoader({ ...process.env, DSH_HOME: home }, tsLoader),
    );
    return;
  }

  if (!(await pathExists(SHELL_ENTRY))) {
    throw new Error(`desktop development: missing built artifact ${SHELL_ENTRY}`);
  }
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

  await launchElectron(workspace, runtimeDir, buildRootDir, tsLoader, home);
}
