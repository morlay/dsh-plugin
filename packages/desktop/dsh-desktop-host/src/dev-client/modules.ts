import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve as resolvePath, sep } from "node:path";
import { rolldown } from "rolldown";

// 开发态的 client 资源按**文件**寻址：`/plugins/{pkgName}/{version}/{filepath}`。仓库自己的包都是 TS/ESM
// 源码（`exports` 在 patch 阶段已改指 `src`），所以逐个文件转译直出即可——浏览器原生 ESM 自己解析依赖，
// 前端资源之间不再受模块表的行集（`inject`）限制。`version` 段取自包清单：既参与寻址，也天然当
// cache-busting，不必再挂 `?rev=`。
//
// 转译交给 rolldown（它内部就是 oxc，且 `output.paths` 正好能做依赖改写）：`external` 全放行 → 不打包、
// 逐文件出 ESM；`paths` 把每个 external 说明符换成 `/plugins/...` 的绝对 URL。

/** 路由前缀（与上游 `/plugins` 同前缀；combo 路由并存，回退时不用改页面）。 */
export const PLUGIN_ROUTE = "/plugins";

/** 仓库里的包：包根按真实路径记（软链已解开），供越界校验。 */
export interface PackageRoot {
  name: string;
  version: string;
  root: string;
}

/** `@deepseek-ai/dsh-x` → `@deepseek-ai+dsh-x`：包名里的 `/` 在 URL 段里要转义。 */
export function encodePackageName(name: string): string {
  return name.replace("/", "+");
}

export function decodePackageName(segment: string): string {
  return segment.replace("+", "/");
}

/** 按文件寻址的解析结果：包名 + 包内相对路径（`src/client/index.ts` 这种）。 */
export interface FileAddress {
  name: string;
  version: string;
  filepath: string;
}

/** 解析 `/plugins/{pkg}/{version}/{filepath}`；不是这个形状返回 undefined（交回 combo 路由）。 */
export function parseFileAddress(url: string): FileAddress | undefined {
  const path = url.split("?")[0] ?? "";
  if (!path.startsWith(`${PLUGIN_ROUTE}/`)) return undefined;
  const segments = path
    .slice(PLUGIN_ROUTE.length + 1)
    .split("/")
    .filter((segment) => segment !== "");
  const [pkgSegment, version, ...fileSegments] = segments;
  if (pkgSegment === undefined || version === undefined || fileSegments.length === 0) return undefined;
  // combo（`??a,b`）与模块表的 `/plugins/<id>/client.js` 都不是这个形状。
  if (pkgSegment.startsWith("??")) return undefined;
  return { name: decodePackageName(pkgSegment), version, filepath: fileSegments.join("/") };
}

/** 包名 → 包根（走 node 解析；软链指到真实目录，越界校验按真实路径做）。 */
export function packageRootOf(from: string, name: string): string | undefined {
  try {
    const require = createRequire(from);
    return dirname(require.resolve(join(name, "package.json")));
  } catch {
    return undefined;
  }
}

/**
 * 按包清单的 `exports` 解析子路径（`./client` → `./src/client/index.ts`）。
 *
 * 不能自己拼 `src/<subpath>`：出口名与文件名**不同构**（`./client` 指向 `src/client/index.ts`、
 * `./remote` 指向 `lib/typert.remote-client.ts` 这类都由清单说了算）。
 */
export async function exportTargetOf(
  root: string,
  subpath: string | undefined,
): Promise<string | undefined> {
  try {
    const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
      exports?: Record<string, unknown>;
    };
    const key = subpath === undefined ? "." : `./${subpath}`;
    const entry = manifest.exports?.[key];
    const target =
      typeof entry === "string"
        ? entry
        : entry === null || typeof entry !== "object"
          ? undefined
          : ((entry as Record<string, unknown>)["types"] ?? (entry as Record<string, unknown>)["default"]);
    if (typeof target !== "string") return undefined;
    return resolveInPackage({ name: "", version: "", root }, target.replace(/^\.\//u, ""));
  } catch {
    return undefined;
  }
}

/** 读包清单（名字 + 版本）。 */
export async function manifestOf(root: string): Promise<{ name: string; version: string } | undefined> {
  try {
    const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
      name?: string;
      version?: string;
    };
    if (manifest.name === undefined) return undefined;
    return { name: manifest.name, version: manifest.version ?? "0" };
  } catch {
    return undefined;
  }
}

/** 向上找最近的包清单（软链已由 node 解析解开）。 */
export async function owningPackageOf(file: string): Promise<PackageRoot | undefined> {
  let directory = dirname(file);
  while (directory !== dirname(directory)) {
    const manifest = await manifestOf(directory);
    if (manifest !== undefined) return { ...manifest, root: directory };
    directory = dirname(directory);
  }
  return undefined;
}

/** 包根 + 包内路径 → 绝对路径；越出包根一律拒绝（寻址来自 URL，不能穿透到仓库别处）。 */
export function resolveInPackage(pkg: PackageRoot, filepath: string): string | undefined {
  const target = resolvePath(pkg.root, filepath);
  const inside = relative(pkg.root, target);
  return inside === "" || inside.startsWith("..") || inside.startsWith(sep) ? undefined : target;
}

/** 一个 specifier 的寻址结果：包名、包内路径、以及它对应的 URL。 */
export interface ResolvedSpecifier {
  name: string;
  filepath: string;
  url: string;
}

/**
 * 把说明符解析成 `/plugins/<pkg>/<version>/<filepath>`。
 *
 * - 裸导入：先按包名解析入口，再按 `exports` 的**子路径**（`@pkg/types`）落文件；
 * - 相对导入：留在同包同版本里（`.ts` / `.tsx` / `/index.ts` 依次试）。
 *
 * 解析不了就返回 undefined——由调用方决定是保持原样（浏览器报 404）还是报错。
 */
export async function resolveSpecifier(options: {
  fromFile: string;
  pkg: PackageRoot;
  specifier: string;
  moduleEntryOf: (name: string, subpath: string | undefined) => Promise<string | undefined>;
}): Promise<ResolvedSpecifier | undefined> {
  const { fromFile, specifier } = options;
  if (specifier.startsWith(".")) {
    const base = resolvePath(dirname(fromFile), specifier);
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
      if (!(await exists(candidate))) continue;
      const target = await owningPackageOf(candidate);
      if (target === undefined) continue;
      return {
        name: target.name,
        filepath: relative(target.root, candidate).split(sep).join("/"),
        url: `${PLUGIN_ROUTE}/${encodePackageName(target.name)}/${target.version}/${relative(target.root, candidate).split(sep).join("/")}`,
      };
    }
    return undefined;
  }
  const slash = specifier.indexOf("/");
  const name = specifier.startsWith("@")
    ? slash < 0
      ? specifier
      : specifier.slice(0, specifier.indexOf("/", slash + 1)) || specifier
    : (specifier.split("/")[0] ?? specifier);
  const subpath = specifier === name ? undefined : specifier.slice(name.length + 1);
  const file = await options.moduleEntryOf(name, subpath);
  if (file === undefined) return undefined;
  const target = await owningPackageOf(file);
  if (target === undefined) return undefined;
  const filepath = relative(target.root, file).split(sep).join("/");
  return {
    name: target.name,
    filepath,
    url: `${PLUGIN_ROUTE}/${encodePackageName(target.name)}/${target.version}/${filepath}`,
  };
}

/**
 * 相对导入 → 同包同版本的绝对 URL（`.ts` / `.tsx` / `/index.ts` 依次试）。找不到就返回 undefined，
 * 让原样的相对路径进到浏览器（404 比静默改错好定位）。
 */
export async function resolveRelativeUrl(
  pkg: PackageRoot,
  fromFile: string,
  specifier: string,
): Promise<string | undefined> {
  const base = resolvePath(dirname(fromFile), specifier);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), `${base}.js`];
  let hit: string | undefined;
  for (const candidate of candidates) {
    if (await exists(candidate)) {
      hit = candidate;
      break;
    }
  }
  if (hit === undefined) return undefined;
  const filepath = relative(pkg.root, hit).split(sep).join("/");
  if (filepath.startsWith("..")) return undefined;
  return `${PLUGIN_ROUTE}/${encodePackageName(pkg.name)}/${pkg.version}/${filepath}`;
}

/**
 * 裸导入 → 目标包源文件的绝对 URL。
 *
 * `clientEntryOf` 给"包名 → 该包的 client 源文件"（模块表就是这么用的）；据此定位包根后，无子路径的按入口、
 * 有子路径的按包清单 `exports` 解析。
 */
export async function resolveBareUrl(
  specifier: string,
  fromFile: string,
  clientEntryOf: (name: string) => string | undefined,
  indexEntryOf: (name: string) => Promise<string | undefined> = async () => undefined,
): Promise<string | undefined> {
  const slash = specifier.indexOf("/");
  const name = specifier.startsWith("@")
    ? slash < 0
      ? specifier
      : (specifier.slice(0, specifier.indexOf("/", slash + 1)) || specifier)
    : (specifier.split("/")[0] ?? specifier);
  const subpath = specifier === name ? undefined : specifier.slice(name.length + 1);
  // 前端资源的依赖很复杂：只有"行"才在模块表里，普通依赖得按 node 的解析规则从**当前文件**出发
  // 找到它的 node_modules（工作区链接、pnpm 的虚拟 store、三方包都走这条路），再把包清单的 `exports`
  // 落到具体文件。都注册成模块反而难用——依赖图不该由模块表决定。
  // 三段：模块表（行）→ 包索引（工作区与上游源码）→ node 解析（node_modules 里的一切，含三方包）。
  const indexed = await indexEntryOf(name);
  if (indexed !== undefined) {
    const manifest = await manifestOf(indexed);
    const target = subpath === undefined ? await exportTargetOf(indexed, undefined) : await exportTargetOf(indexed, subpath);
    if (manifest !== undefined && target !== undefined) {
      const filepath = relative(indexed, target).split(sep).join("/");
      return `${PLUGIN_ROUTE}/${encodePackageName(manifest.name)}/${manifest.version}/${filepath}`;
    }
  }
  const clientPath =
    clientEntryOf(name) ?? (await entryFileOf(fromFile, name, subpath));
  if (clientPath === undefined) return undefined;
  const owner = await owningPackageOf(clientPath);
  if (owner === undefined) return undefined;
  const target = subpath === undefined ? clientPath : await exportTargetOf(owner.root, subpath);
  if (target === undefined) return undefined;
  const filepath = relative(owner.root, target).split(sep).join("/");
  return `${PLUGIN_ROUTE}/${encodePackageName(owner.name)}/${owner.version}/${filepath}`;
}

/**
 * 扫出「包名 → 包根」的索引：工作区与上游各自的 `packages/<组>/<包>`。
 *
 * 依赖解析的最后一道兜底：消费方的 `node_modules` 里不一定有目标包（`@deepseek-ai/*` 常常只被别的包
 * 依赖），而工作区与上游的源码都在仓库里，直接按目录扫一遍比一路试 `require.resolve` 靠谱。
 */
export async function buildPackageIndex(roots: readonly string[]): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  const visit = async (directory: string): Promise<void> => {
    const manifest = await manifestOf(directory);
    if (manifest !== undefined) {
      index.set(manifest.name, directory);
      return;
    }
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      await visit(join(directory, entry.name));
    }
  };
  for (const root of roots) {
    for (const base of ["packages", join("vendor", "deepseek-harness", "packages")]) {
      await visit(join(root, base));
    }
  }
  return index;
}

/**
 * 按 node 的解析规则找包：从 `fromFile` 出发，失败再试**额外解析根**。
 *
 * 消费方的 `node_modules` 里不一定有目标包（`@deepseek-ai/*` 只在 vendor 那边、工作区包各有各的依赖面），
 * 所以除了当前文件的目录，还要按仓库根与上游根解析一遍——vite 用「项目根」当解析根是同一个意思。
 */
async function entryFileOf(
  fromFile: string,
  name: string,
  subpath: string | undefined,
): Promise<string | undefined> {
  const roots = [fromFile];
  const root = packageRootOf(fromFile, name);
  if (root === undefined) return undefined;
  const byExports = await exportTargetOf(root, subpath);
  if (byExports !== undefined) return byExports;
  for (const from of roots) {
    try {
      const require = createRequire(from);
      return require.resolve(subpath === undefined ? name : `${name}/${subpath}`);
    } catch {
      // 换下一个解析根。
    }
  }
  return undefined;
}

/** 逐文件转译：不打包、只改依赖 URL，产物是浏览器可直接 `import` 的 ESM。 */
export async function transpileFile(options: {
  file: string;
  rewrite: (specifier: string) => Promise<string | undefined> | undefined;
}): Promise<string> {
  // 依赖改写走 `resolveId`：它可以是异步的（`paths` 同步，做不了文件探测），返回的 URL 直接当 external id
  // ——产物里的 import 就换成 `/plugins/...` 绝对地址，浏览器自己按 URL 取。
  const rewritePlugin = {
    name: "dev-client-rewrite",
    async resolveId(source: string, importer: string | undefined) {
      // 入口（没有 importer）必须让 rolldown 自己加载：入口不能是 external。
      if (importer === undefined) return null;
      const url = await options.rewrite(source);
      return url === undefined ? { id: source, external: true } : { id: url, external: true };
    },
  };
  const build = await rolldown({
    input: options.file,
    cwd: dirname(options.file),
    platform: "browser",
    // **不设** `external`：那个钩子对所有 id 先命中，会把 `resolveId` 插件绕过去（依赖原样留在产物里）。
    // 依赖改由 `rewritePlugin` 决定：改写成 URL 的标 external（浏览器去取），入口让它自己加载。
    resolve: { conditionNames: ["browser", "import", "default"] },
    plugins: [rewritePlugin],
  });
  try {
    const { output } = await build.generate({
      format: "esm",
      codeSplitting: false,
    });
    const chunk = output.find((item) => item.type === "chunk");
    if (chunk === undefined || chunk.type !== "chunk") {
      throw new Error(`dev-client: ${options.file} produced no chunk`);
    }
    return chunk.code;
  } finally {
    await build.close();
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}
