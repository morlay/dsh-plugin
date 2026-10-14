// 「格」的定义：装配根 / 解析根 / 数据根，以及**由它们派生**的那些路径。
//
// 术语与两种形态的取值组合见 `../../../../devpackages/dshdev/.agents/GLOSSARY.md`。这里的规矩是：
// **路径只在这里拼**——别处取名字（`storeDir()`、`profileManifest()`），不手写
// `join(x, "node_modules", ".pnpm")` 这种串。那些串散在各处时，改一格要满仓找，且两种形态各错一次。
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLIENT_MODULES_CACHE } from "./bundle.ts";
import { isDevForm } from "./config.ts";
import { workspaceRootOf } from "./resolve.ts";

/** 本包自己的根（页面的骨架、`node-stub` 与依赖解析的兜底基准都从它推）。 */
export function packageRoot(): string {
  return dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
}

/** 页面与入口所在的目录（vite 的 root）：本包的 `app-boot`。 */
export function appBootDir(): string {
  return join(packageRoot(), "app-boot");
}

/** 本包的清单（依赖解析的一个基准：这条链的运行期依赖声明在它里面）。 */
export function packageManifestPath(): string {
  return join(packageRoot(), "package.json");
}

/**
 * 装配根（profileDir）：这份部署装配出来的那一格。
 *
 * dev 是工作区里的 app 目录（`dshdev` 给的 `DSH_DESKTOP_DEV_PROFILE_DIR`），bundle 是宿主进程的 cwd
 * （壳把宿主的 cwd 设成 `<dataDir>/profiles/<name>`）。
 *
 * @returns 第一个带 `package.json` 的候选取值；都没有时退回 cwd。
 */
export async function profileDir(): Promise<string> {
  const candidates = [process.env["DSH_DESKTOP_DEV_PROFILE_DIR"], process.cwd()].filter(
    (value): value is string => value !== undefined && value !== "",
  );
  for (const candidate of candidates) {
    if (await readFile(join(candidate, "package.json"), "utf8").then(() => true, () => false)) {
      return candidate;
    }
  }
  return process.cwd();
}

/** 装配根的清单：`<profileDir>/package.json`（pnpm 从这里解析到装配行与工作区的包）。 */
export async function profileManifestPath(): Promise<string> {
  return join(await profileDir(), "package.json");
}

/**
 * 解析根：依赖解析、watch、缓存的基准。
 *
 * dev 再向上找**工作区根**（`node_modules` 与 lockfile 在那儿）；bundle 的装配根本身就带自己的
 * `node_modules`，就是它。
 */
export async function resolutionRoot(): Promise<string> {
  resolutionRootPromise ??= (async () => {
    const profile = await profileDir();
    return isDevForm() ? ((await workspaceRootOf(profile)) ?? profile) : profile;
  })();
  return await resolutionRootPromise;
}

let resolutionRootPromise: Promise<string> | undefined;

/**
 * 数据根（`$DSH_HOME`）：会话、设置、附件、日志。
 *
 * dev 缺省是 `<装配根>/.dsh-store`（`dshdev` 会显式给值），bundle 由壳按 app 的 `dsh.desktop.dataDir`
 * 解析后经环境传进来。
 */
export async function dataDir(): Promise<string> {
  return process.env["DSH_HOME"] ?? join(await profileDir(), ".dsh-store");
}

/** 解析根的清单：`<解析根>/package.json`（依赖解析的另一个基准）。 */
export async function resolutionManifestPath(): Promise<string> {
  return join(await resolutionRoot(), "package.json");
}

/** pnpm 的虚拟 store：`<解析根>/node_modules/.pnpm`。 */
export async function storeDir(): Promise<string> {
  return join(await resolutionRoot(), "node_modules", ".pnpm");
}

/** 这条链自己的缓存目录（联邦产物与聚合结果，与 vite 的 `.vite` 并列）。 */
export async function cacheDir(): Promise<string> {
  return join(await resolutionRoot(), CLIENT_MODULES_CACHE);
}
