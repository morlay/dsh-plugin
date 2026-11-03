import { logOf } from "@local/devkit/log";
import { createHash, type Hash } from "node:crypto";
import type { Dirent } from "node:fs";
import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import { OFFICIAL_PROFILE_BUNDLES } from "@morlay/dsh-desktop-shell/official";
import { PROFILE_WORKSPACE_NAME } from "@morlay/dsh-desktop-shell/profile-project";
import { SEED_HASH_NAME, SEED_RUNTIME_DIR_NAME } from "@morlay/dsh-desktop-shell/seed";
import { closurePackageDirs, copyPackageTree, missingOfficialPackages } from "./official-deps.ts";
import {
  PROFILE_NAME,
  desktopProfileBundles,
  buildCache,
  findWorkspaceRoot,
  mergedDeploySettings,
  mergedProfileBundles,
  resolveWorkspace,
  topLevelYamlBlock,
  workspaceManifest,
  runPnpm,
  type WorkspaceManifest,
} from "./workspace.ts";

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function inheritDeploySettings(root: string, destination: string): Promise<void> {
  const sourcePath = join(root, "pnpm-workspace.yaml");
  const targetPath = join(destination, "pnpm-workspace.yaml");
  if (!(await pathExists(sourcePath)) || !(await pathExists(targetPath))) return;
  const target = await readFile(targetPath, "utf8");
  const merged = mergedDeploySettings(await readFile(sourcePath, "utf8"), target);
  if (merged !== target) await writeFile(targetPath, merged);
}

/**
 * 闭包里缺官方包时的报错：`missing` 是「缺的包 → 谁声明了它」（见 `missingOfficialPackages`）。
 * @param missing - 缺失的官方包与它们的声明方。
 * @returns 可读的错误。
 */
const log = logOf("dshdev");

export function missingOfficialPackagesError(
  missing: ReadonlyMap<string, readonly string[]>,
): Error {
  const detail = [...missing]
    .map(([packageName, requiredBy]) => `${packageName} (required by ${requiredBy.join(", ")})`)
    .join("; ");
  return new Error(
    `deployed closure is missing official packages: ${detail}; ` +
      "check that the app's dsh.profile.bundles and dependencies agree",
  );
}

/**
 * 剔掉**本机的构建缓存**（`.dsh-client-modules`）。
 *
 * 它是这台机器上"按需预编译"的产物（几百 MB、内容随本机改动漂），既不该进 seed，也不该跟着闭包被拷来拷去
 * ——换个工作目录就该重新构建，带着它只会让两边看到不同世代的产物。
 *
 * @param surface - 装配面的根目录。
 */
async function dropClientModulesCache(surface: string): Promise<void> {
  // 目录名与 `@morlay/dsh-client-modules` 的 `CLIENT_MODULES_CACHE` 同源（那边没把它放进包出口——为一个常量
  // 扩公开面不值当，这里就地写死并靠这条注释对齐）。
  const cache = join("node_modules", ".dsh-client-modules");
  for (const entry of await readdir(surface, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "node_modules") {
      await rm(join(surface, cache), { recursive: true, force: true });
      continue;
    }
    await dropClientModulesCache(join(surface, entry.name));
  }
}

/**
 * **验证用的装配面**（`dshdev web|desktop --prod`）：只做 `pnpm deploy` 的闭包，拿 deploy 目录当
 * profile/runtime 就闭环了。
 *
 * deploy 目录里已经有 `package.json` 与 `node_modules`（含 `.pnpm` 虚拟店）——解析根要的东西齐了；再把 app
 * 的 profile 面文件（`cordis.yml` 等）带过去，宿主就能像打包形态那样起来。
 *
 * 与 {@link runPrepareSeed} 的分工：那一条是**打包形态**的完整装配（官方闭包、profile 清单、typert 生成物、
 * 壳装配、seed 布局），验证"打包形态的解析面"用不上它后面那些阶段——所以别调它。
 *
 * @param workspace - app 工作区目录。
 * @returns deploy 目录（当 profileDir 与 runtimeDir 用）。
 */
export async function prepareDeploySurface(workspace: string): Promise<string> {
  const manifest = await workspaceManifest(workspace);
  const destination = join(buildCache(workspace), "deploy");
  log.info("deploy %o", { dir: destination });
  await deployClosure(workspace, manifest.name, destination);
  // profile 面那几个文件（行清单等）按 app 的样子带过去：deploy 的产物是"安装结果"，不含它们。
  for (const entry of seedEntries(workspace, manifest)) {
    const source = join(workspace, entry);
    if (!(await pathExists(source))) continue;
    await copyPackageTree(source, join(destination, entry));
  }
  await dropClientModulesCache(destination);
  return destination;
}

export async function deployClosure(
  workspace: string,
  name: string,
  destination: string,
): Promise<void> {
  const root = await findWorkspaceRoot(workspace);
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  const args = root !== resolve(workspace) ? ["--filter", name] : [];
  // **`injectWorkspacePackages`**：workspace 依赖按**内容**装进 deploy，而不是留一条指回仓库的链接。
  // 一次 deploy（十来秒）就得到自包含的闭包——不必事后逐个实体化（那是 49 次拷贝），也不必为了 registry
  // 侧再装一遍（那是第二次 install，纯重复）。
  await runPnpm(
    [
      ...args,
      "--config.inject-workspace-packages=true",
      "deploy",
      "--prod",
      "--ignore-scripts",
      destination,
    ],
    root,
  );
  const modulesDir = join(destination, "node_modules");
  if (!(await pathExists(modulesDir))) {
    throw new Error(`pnpm deploy did not produce ${modulesDir}`);
  }

  await inheritDeploySettings(root, destination);
  // `.pnpm` 里的包挂到顶层：profile 解压出来要像一份普通 `node_modules`（上游 profile 也是扁平布局）。
  await linkClosureTopLevel(modulesDir);

  const missing = await missingOfficialPackages(modulesDir);
  if (missing.size > 0) {
    throw missingOfficialPackagesError(missing);
  }
  await assertCuaNativePayload(modulesDir, process.platform, process.arch);
}

/** Computer Use 那一行（它的 native 载荷是发布产物，见 `assertCuaNativePayload`）。 */
const CUA_PACKAGE = "@deepseek-ai/dsh-experimental-cua-macos";

/**
 * 闭包里缺 CUA 的 native 载荷时的报错（消息里带**怎么补**，别让人对着一个坏包猜）。
 */
export function missingCuaNativeError(packageRoot: string, directory: string): Error {
  return new Error(
    `deployed closure has no CUA native payload: ${join(packageRoot, "native", "bin", directory, "current.json")} is missing; ` +
      "build it once on macOS with Xcode (`pnpm --filter @deepseek-ai/dsh-experimental-cua-macos run build:native`) " +
      "before bundling — upstream gitignores native/bin, so a source checkout never carries it",
  );
}

/**
 * CUA 的 native 载荷是**发布产物**：上游把 `native/bin/` 写进了 `.gitignore`，发布包里的那份由 macOS
 * CI 签好随包分发。源码树形态（dev）走 `.build/prepared/<arch>/` 现场编译（`isSourcePackage` 为 true）；
 * 而装进 app 的闭包是"已安装"形态，只认 `native/bin/darwin-<arch>/current.json`。缺了它包照样装得上、
 * 用户点开 Computer Use 才炸——所以在打包这一步拦下来。
 *
 * 非 macOS 不看：上游只产 macOS 载荷，这一行在别的平台本来也用不了；闭包里没这一行也不管。
 */
export async function assertCuaNativePayload(
  modulesDir: string,
  platform: NodeJS.Platform,
  architecture: string,
): Promise<void> {
  if (platform !== "darwin") return;
  const packageRoot = (await closurePackageDirs(modulesDir)).get(CUA_PACKAGE);
  if (packageRoot === undefined) return;
  const directory = `darwin-${architecture === "x64" ? "x64" : "arm64"}`;
  if (await pathExists(join(packageRoot, "native", "bin", directory, "current.json"))) return;
  throw missingCuaNativeError(packageRoot, directory);
}

async function linkClosureTopLevel(modulesDir: string): Promise<void> {
  const store = join(modulesDir, ".pnpm");
  if (!(await pathExists(store))) return;
  for (const entry of await readdir(store, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const inner = join(store, entry.name, "node_modules");
    if (!(await pathExists(inner))) continue;
    for (const [name, dir] of await closurePackageDirs(inner)) {
      const link = join(modulesDir, ...name.split("/"));
      if (await pathExists(link)) continue;
      await mkdir(dirname(link), { recursive: true });
      await symlink(relative(dirname(link), dir), link, "dir");
    }
  }
}

function seedEntries(workspace: string, manifest: { files?: string[] }): string[] {
  const entries = new Set(["package.json"]);
  for (const file of manifest.files ?? []) {
    const cleaned = file.replaceAll("\\", "/").replace(/^\.\//u, "");
    if (cleaned === "" || cleaned === "." || cleaned.startsWith("/") || cleaned.startsWith("../"))
      continue;
    entries.add(cleaned);
  }
  return [...entries].sort();
}

const TREE_SKIP_DIRS = new Set([
  ".bin",
  ".cache",
  ".git",
  ".dsh-store",
  ".pnpm-store",
  ".turbo",
  "node_modules",
]);

const LOCAL_PACKAGE_SCAN_DEPTH = 6;

async function hashPath(hash: Hash, root: string, relativePath: string): Promise<void> {
  const path = join(root, ...relativePath.split("/"));
  if (!(await pathExists(path))) return;
  const info = await stat(path);
  if (info.isDirectory()) {
    for (const entry of (await readdir(path)).sort()) {
      if (TREE_SKIP_DIRS.has(entry)) continue;
      await hashPath(hash, root, `${relativePath}/${entry}`);
    }
    return;
  }
  if (!info.isFile()) return;
  hash.update(relativePath);
  hash.update("\0");
  hash.update(await readFile(path));
  hash.update("\0");
}

async function packageName(manifestPath: string): Promise<string | undefined> {
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { name?: unknown };
    return typeof manifest.name === "string" && manifest.name !== "" ? manifest.name : undefined;
  } catch {
    return undefined;
  }
}

async function localPackageDirs(root: string): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const visit = async (dir: string, depth: number): Promise<void> => {
    if (depth > LOCAL_PACKAGE_SCAN_DEPTH) return;
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || TREE_SKIP_DIRS.has(entry.name))
        continue;
      const child = join(dir, entry.name);
      const manifestPath = join(child, "package.json");
      if (await pathExists(manifestPath)) {
        const name = await packageName(manifestPath);
        if (name !== undefined && !found.has(name)) found.set(name, child);
      }
      await visit(child, depth + 1);
    }
  };
  await visit(root, 0);
  return found;
}

async function packageEntries(dir: string): Promise<string[]> {
  const found: string[] = [];
  const visit = async (current: string, prefix: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules") continue;
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      found.push(path);
      if (entry.isDirectory()) await visit(join(current, entry.name), path);
    }
  };
  await visit(dir, "");
  return found.sort();
}

export async function seedFingerprint(input: {
  readonly workspace: string;
  readonly workspaceRoot: string;
  readonly entries: readonly string[];
  readonly closureModulesDir: string;
  readonly seedRoot: string;
}): Promise<string> {
  const hash = createHash("sha256");
  hash.update("workspace\0");
  for (const entry of input.entries) await hashPath(hash, input.workspace, entry);
  hash.update("lockfile\0");
  const lockfile = join(input.workspaceRoot, "pnpm-lock.yaml");
  if (await pathExists(lockfile)) {
    hash.update(await readFile(lockfile));
    hash.update("\0");
  }

  const closure = await closurePackageDirs(input.closureModulesDir);
  hash.update("closure\0");
  for (const name of closure.keys()) {
    hash.update(`${name}\0`);
  }
  hash.update("local-closure\0");
  const local = await localPackageDirs(input.workspaceRoot);
  for (const name of closure.keys()) {
    if (!local.has(name)) continue;
    hash.update(`${name}\0`);
    await hashPath(hash, input.closureModulesDir, name);
  }

  hash.update("installed-closure\0");
  for (const [name, dir] of closure) {
    if (local.has(name)) continue;
    hash.update(`${name}\0`);
    for (const entry of await packageEntries(dir)) hash.update(`${entry}\0`);
  }
  await hashSeedLayout(hash, input.seedRoot);
  return hash.digest("hex");
}

// Hash the seed's own layout (generated manifests and settings); closure contents are covered by
// the closure inputs above, and `vendor/` is enumerated because its payload is a closure copy.
async function hashSeedLayout(hash: Hash, seedRoot: string): Promise<void> {
  hash.update("seed-layout\0");
  const visit = async (directory: string, prefix: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((left, right) => (left.name < right.name ? -1 : 1))) {
      if (entry.name === "node_modules" || entry.name === SEED_HASH_NAME) continue;
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const child = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(child, path);
        continue;
      }
      if (!entry.isFile()) continue;
      hash.update(path);
      hash.update("\0");
      hash.update(await readFile(child));
      hash.update("\0");
    }
  };
  await visit(seedRoot, "");
}

// Enumerate the `file:` sources by package path; their payload is a closure copy already hashed.
export interface PrepareSeedOptions {
  readonly workspace?: string;
}

export async function runPrepareSeed(options: PrepareSeedOptions): Promise<void> {
  const workspace = resolve(options.workspace ?? resolveWorkspace());
  const manifest = await workspaceManifest(workspace);
  const workspaceRoot = await findWorkspaceRoot(workspace);
  const buildCacheDir = buildCache(workspace);
  const seedOutputRoot = join(buildCacheDir, "seed");
  const deployRoot = join(buildCacheDir, "deploy");
  const entries = seedEntries(workspace, manifest);
  log.info("seed %o", { workspace: workspace, "app.name": manifest.name });
  log.info("seed.entries %o", { entries: entries });

  await deployClosure(workspace, manifest.name, deployRoot);

  await rm(seedOutputRoot, { recursive: true, force: true });
  const runtimeDir = join(seedOutputRoot, SEED_RUNTIME_DIR_NAME);
  const profileDir = join(seedOutputRoot, "profiles", PROFILE_NAME);
  await mkdir(runtimeDir, { recursive: true });
  await mkdir(profileDir, { recursive: true });

  // 运行时载荷：deploy 闭包就是 host 的 dsh 安装（解析锚点）与前端静态资源的来源；
  // 它在产物里不可变，也不再被种进用户的 DSH_HOME。
  await cp(join(deployRoot, "package.json"), join(runtimeDir, "package.json"));

  // **profile 的依赖面不再随 seed 走**：闭包与清单一并打进 app（`Resources/app.asar/profile`，见
  // `../.agents/designs/20261016-随包布局：app 进 asar、宿主依赖住 runtime.md`），首启因此不需要落任何依赖。

  // profile 只持有 app 自带的（非官方 bundle）插件；依赖面整体由上面那份 tar 承载（解压即实体闭包），
  // 不再逐包 `link:` 回 runtime，也不再产 `desktop-runtime-packages.json` 那份载荷清单。
  const localBundles = profileLocalBundles(manifest);
  await copyProfileEntries(workspace, profileDir, entries);
  await writeFile(
    join(profileDir, "package.json"),
    `${JSON.stringify(profileManifest(manifest), undefined, 2)}\n`,
  );
  await writeFile(join(profileDir, "tsconfig.json"), profileTsconfig());
  await writeFile(
    join(profileDir, PROFILE_WORKSPACE_NAME),
    profileWorkspace(await allowedBuilds(deployRoot)),
  );

  const fingerprint = await seedFingerprint({
    workspace,
    workspaceRoot,
    entries,
    closureModulesDir: join(deployRoot, "node_modules"),
    seedRoot: seedOutputRoot,
  });
  await writeFile(join(profileDir, SEED_HASH_NAME), fingerprint);
  log.info("seed %o", {
    dir: seedOutputRoot,
    fingerprint: fingerprint.slice(0, 12),
    bundles: localBundles,
  });
}

// Bundles the profile itself owns; shipped bundles come from the runtime installation instead.
export function profileLocalBundles(manifest: WorkspaceManifest): string[] {
  return desktopProfileBundles(manifest).filter((name) => !OFFICIAL_PROFILE_BUNDLES.includes(name));
}

// profile 的直接依赖要带上本地依赖的闭包：pnpm 对 `file:` 包自己声明的 `workspace:` 依赖**静默跳过**
// （实测 `pnpm install` 只装直接依赖，一条告警都没有），于是 profile 里那些 bundle 的行引到
// `@morlay/*` 时整个 `failed to import`。上游包（`@deepseek-ai/*`）不进这份清单：它们由 runtime 的
// 解析锚点提供，抄进 profile 只是把同一份源码再复制一遍。

// Generate the profile manifest: app identity plus the assembly rows it declares.
//
// **`dependencies` 只列"非 `@deepseek-ai` 前缀"的直接依赖**（本地工作区包），版本写**具体值**（app 的
// `version`，它们与 app 同源发布）——`workspace:*` 在 profile 里解析不了，而 profile 是安装产物。
//
// 上游包（`@deepseek-ai/*`）**不进这份清单**：它们由 runtime 的解析锚点提供，抄进 profile 只是把同一份
// 源码再复制一遍。这份清单是**插件管理页判定 `installed` 的依据**（`plugin-manager` 读 `dependencies`），
// 缺了它，随包带来的行会呈现成"未安装"。
//
// profile 是安装产物：清单按官方形态写（官方 bundles 在前 + app 自己声明的），只保留装配字段，
// app 的 `dsh.version` / `desktop` / `dev` 属于打包输入，运行时不再从 profile 读它们。
export function profileManifest(manifest: WorkspaceManifest): Record<string, unknown> {
  const dependencies = profileDependencies(manifest);
  return {
    name: manifest.name,
    private: true,
    version: manifest.version ?? "0.0.0",
    type: "module",
    ...(Object.keys(dependencies).length === 0 ? {} : { dependencies }),
    dsh: { profile: { ...manifest.dsh?.profile, bundles: mergedProfileBundles(manifest) } },
  };
}

/**
 * profile 清单里的直接依赖：非 `@deepseek-ai` 前缀的那些，版本落到具体值。
 * @param manifest - app 的工作区清单。
 * @returns 依赖名到具体版本的映射（可能为空对象）。
 */
export function profileDependencies(manifest: WorkspaceManifest): Record<string, string> {
  const version = manifest.version ?? "0.0.0";
  const dependencies: Record<string, string> = {};
  for (const [name, specifier] of Object.entries(manifest.dependencies ?? {})) {
    if (name.startsWith("@deepseek-ai/")) continue;
    dependencies[name] = specifier.startsWith("workspace:") ? version : specifier;
  }
  return dependencies;
}

/**
 * profile 自带的 `tsconfig.json`。
 *
 * **profile 是个完整的项目**：清单、pnpm 设置、依赖、以及这份编译设置都在它里面。vite 是**从 root 往上找
 * tsconfig** 拿 `experimentalDecorators` 的，而打包形态下这条链的 root 正是 profile —— 少了这份文件，
 * 上游那些用 cordis 装饰器的包就原样留着 `@Remote(...)`，浏览器报
 * `Uncaught SyntaxError: Invalid or unexpected token`，入口整条不执行。
 *
 * 自包含（不 `extends` 仓库里的任何东西）：profile 是要搬到用户机器上跑的，那里没有仓库。
 * 关键项与 `@local/devkit/tsconfig.json` 同一份语义——`experimentalDecorators` 与 `jsx` 是这里真正被用到的。
 */
export function profileTsconfig(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        module: "nodenext",
        target: "esnext",
        jsx: "react-jsx",
        experimentalDecorators: true,
        allowImportingTsExtensions: true,
        verbatimModuleSyntax: false,
        isolatedModules: false,
        skipLibCheck: true,
      },
    },
    undefined,
    2,
  )}\n`;
}

// Profile pnpm settings shared by the seed and every later package operation.
export function profileWorkspace(allowBuilds: string): string {
  return `packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n${allowBuilds}`;
}

// Copy the app's whitelisted files into the profile; the manifest is generated, never copied.
async function copyProfileEntries(
  workspace: string,
  profileDir: string,
  entries: readonly string[],
): Promise<void> {
  for (const entry of entries) {
    if (entry === "package.json") continue;
    const source = join(workspace, ...entry.split("/"));
    if (!(await pathExists(source))) continue;
    const target = join(profileDir, ...entry.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target, { recursive: true });
  }
}

// Copy each profile-owned bundle out of the closure as an installable `file:` source.

// runtime 包：profile 要装的东西（自己的 bundles 及其闭包）经 `overrides` 指回 runtime 副本，写成
// runtime-relative 的 `link:`。
//
// **这些包本身也在名单里**：profile 的 `dependencies` 由壳照这份名单写，少了它们，装配行（如
// `@morlay/web-custom-profile`）就根本不会被装进 profile，宿主那边表现是一排 `failed to import`。
//
// profile 里的包来自工作区（`file:`），依赖在 profile 内解析不到（无工作区、离线无 registry）；
// peer / optional 找不到就跳过（profile 安装不装 peer），普通依赖找不到即打包失败。取舍见
// `../../.agents/designs/20260917-桌面化工具.md`。
export async function profileRuntimeLinks(
  runtimeRoot: string,
  runtimeModulesDir: string,
  names: readonly string[],
): Promise<{ name: string; path: string }[]> {
  const required = new Map<string, boolean>();
  for (const name of names) {
    const manifestPath = join(runtimeModulesDir, ...name.split("/"), "package.json");
    if (!(await pathExists(manifestPath))) continue;
    // 包**自己**也是 profile 要装的一份。
    required.set(name, true);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      required.set(dependency, true);
    }
    for (const section of [manifest.peerDependencies, manifest.optionalDependencies]) {
      for (const dependency of Object.keys(section ?? {})) {
        if (!required.has(dependency)) required.set(dependency, false);
      }
    }
  }
  if (required.size === 0) return [];

  const closure = await closurePackageDirs(runtimeModulesDir);
  const canonicalRoot = await realpath(runtimeRoot);
  const links: { name: string; path: string }[] = [];
  const missing: string[] = [];
  for (const dependency of [...required.keys()].sort()) {
    const dir = closure.get(dependency);
    if (dir !== undefined) {
      links.push({ name: dependency, path: relative(canonicalRoot, dir) });
      continue;
    }
    if (required.get(dependency) === true) missing.push(dependency);
  }
  if (missing.length > 0) {
    throw new Error(
      `the deployed closure is missing dependencies of the profile's own bundles: ` +
        `${missing.join(", ")}`,
    );
  }
  return links;
}

// The workspace `allowBuilds` block pnpm wrote into the deploy project, carried into the profile.
async function allowedBuilds(deployRoot: string): Promise<string> {
  const path = join(deployRoot, PROFILE_WORKSPACE_NAME);
  if (!(await pathExists(path))) return "";
  return topLevelYamlBlock(await readFile(path, "utf8"), "allowBuilds") ?? "";
}
