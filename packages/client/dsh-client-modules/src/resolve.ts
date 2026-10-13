import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve as resolvePath, sep } from "node:path";


// 开发态的 client 资源按**文件**寻址：`/plugins/{pkgName}/{version}/{filepath}`。仓库自己的包都是 TS/ESM
// 源码（`exports` 在 patch 阶段已改指 `src`），所以逐个文件转译直出即可——浏览器原生 ESM 自己解析依赖，
// 前端资源之间不再受模块表的行集（`inject`）限制。`version` 段取自包清单：既参与寻址，也天然当
// cache-busting，不必再挂 `?rev=`。
//
// 转译与依赖图交给 vite（dev server 的模块图 + 依赖预打包），这里只做**对外地址**的解析。

/** 路由前缀（沿用上游的 `/plugins`，页面上不改 URL 形态）。 */
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

/**
 * 按「包与出口」寻址的解析结果：`/plugins/<pkg>/<export>`。
 *
 * 与"按文件"不同：一个出口对应**一份产物**（rolldown 打包，包内相对导入 inline、跨包引用 external 成
 * 对方出口的 URL）。出口名与文件名不同构（`./client` → `src/client/index.ts`、`./remote` →
 * `lib/typert.remote-client.ts`），所以寻址只能按清单的 `exports` 来，不能按文件。
 */
export interface ExportAddress {
  name: string;
  /** 出口名：根出口写成 `.`，其余是清单里的键（`./client`）。 */
  exportName: string;
}

/**
 * 权威寻址：`/plugins/{pkg}/{version}/{export}?rev=…`。
 *
 * - `pkg` 里的 `/` 转义成 `+`（`@scope/name` → `@scope+name`）；
 * - `export` 默认 `_default`（= 清单的 `"."` 出口），其余是出口名（`client` → `"./client"`）；
 * - `rev` 是 query，可省（服务端按内容算得出来）。
 *
 * 三方包与仓库包**同格式**：访问这件事上它们没有区别。
 */
export interface PluginAddress {
  name: string;
  version: string;
  /** 出口名：`"."` 或 `"./client"` 这类清单键。 */
  exportName: string;
}

/** URL 段里的默认出口写法。 */
export const DEFAULT_EXPORT_SEGMENT = "_default";

export function parsePluginAddress(url: string): PluginAddress | undefined {
  const path = url.split("?")[0] ?? "";
  if (!path.startsWith(`${PLUGIN_ROUTE}/`)) return undefined;
  const segments = path.slice(PLUGIN_ROUTE.length + 1).split("/").filter((segment) => segment !== "");
  // 不是按包寻址的都放行（上游的 combo `??a,b` 那类；如今资源由 vite 直接服务，这条路只留兜底）。
  if (segments[0]?.startsWith("??") === true || segments[0]?.startsWith(".") === true) return undefined;
  const [pkgSegment, version, ...exportSegments] = segments;
  if (pkgSegment === undefined || version === undefined) return undefined;
  const exportSegment = exportSegments.join("/");
  return {
    name: decodePackageName(pkgSegment),
    version,
    exportName:
      exportSegment === "" || exportSegment === DEFAULT_EXPORT_SEGMENT ? "." : `./${exportSegment}`,
  };
}

/**
 * 条件导出里挑**运行期**入口：`import` > `default` > `require` > `types`。
 *
 * 条件是**可嵌套**的（`zustand` 的 `./vanilla` 出口就是
 * `{ import: { types, default }, default: { types, default } }`），所以命中条件后要继续往里挑——
 * 只看顶层字符串会跳过 `import` 落到 `default`，拿到 CJS 那支（`vanilla.js` 而不是 `esm/vanilla.mjs`），
 * 产物里就只剩 `export default require_…`，消费方要的具名导出一个都没有。
 */
function pickCondition(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry;
  // **数组**形态（`@oxc-project/runtime` 的每个出口都是 `[{ node, import, default }, "./src/…"]`）：
  // node 的语义是"依次尝试"，这里取第一个答得上来的。
  if (Array.isArray(entry)) {
    for (const item of entry) {
      const picked = pickCondition(item);
      if (picked !== undefined) return picked;
    }
    return undefined;
  }
  if (entry === null || typeof entry !== "object") return undefined;
  const record = entry as Record<string, unknown>;
  for (const key of ["import", "default", "require", "types"]) {
    if (!(key in record)) continue;
    const picked = pickCondition(record[key]);
    if (picked !== undefined) return picked;
  }
  return undefined;
}



/** 按文件寻址的解析结果：包名 + 包内相对路径（`src/client/index.ts` 这种）。 */
export interface FileAddress {
  name: string;
  version: string;
  filepath: string;
}


/**
 * 工作区包索引：包名 → 包根。
 *
 * `pnpm` 的布局只保证"**能解析的**才在"——vendor 里的包、以及当前包没声明为依赖的工作区包，从 importer
 * 出发都解析不到。但它们是**仓库内的包**（有自己的 `exports`、自己的 `./client` 出口），不该被当成三方。
 * 所以扫一遍仓库内的清单，懒建一次索引。
 */
let workspaceIndex: Promise<Map<string, string>> | undefined;

/** 从某个文件向上找仓库根（`pnpm-workspace.yaml` 那一层）。 */
export async function workspaceRootOf(from: string): Promise<string | undefined> {
  let directory = dirname(from);
  for (;;) {
    if (await readFile(join(directory, "pnpm-workspace.yaml"), "utf8").then(() => true, () => false)) {
      return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

/**
 * 仓库内**命中给定 glob** 的包（包名 + 包根）。
 *
 * 预打包与联邦寻址都要它：非开发模块不只是"行"，还有 `ui-primitives` 这种共享库；版本表也要覆盖
 * 那些没进行清单、却会被外置说明符提到的包（cordis、client-store…）。
 *
 * @param from - 解析基准（用来找仓库根）。
 * @param patterns - 匹配包名的正则。
 * @returns 命中的包。
 */
export async function workspacePackagesMatching(
  from: string,
  patterns: readonly RegExp[],
): Promise<{ name: string; root: string }[]> {
  const index = await workspaceIndexOf(from);
  return [...index.entries()]
    .filter(([name]) => patterns.some((pattern) => pattern.test(name)))
    .map(([name, root]) => ({ name, root }));
}

async function workspaceIndexOf(from: string): Promise<Map<string, string>> {
  workspaceIndex ??= (async () => {
    const index = new Map<string, string>();
    const root = await workspaceRootOf(from);
    if (root === undefined) return index;
    const { glob } = await import("node:fs/promises");
    for (const pattern of [
      "packages/*/*/package.json",
      "vendor/*/packages/*/*/package.json",
      // 上游把自己的依赖 vendors 在仓库内（cordis、cosmokit…），它们也参与联邦寻址。
      "vendor/*/vendor/*/package.json",
    ]) {
      for await (const file of glob(pattern, { cwd: root })) {
        const path = join(root, file);
        const manifest = JSON.parse(await readFile(path, "utf8").catch(() => "{}")) as {
          name?: string;
        };
        if (manifest.name !== undefined) index.set(manifest.name, dirname(path));
      }
    }
    return index;
  })();
  return await workspaceIndex;
}

/**
 * 包名 → 包根：走 node 的解析（pnpm 已经把依赖摆好了），**解析入口**再向上找最近的清单。
 *
 * 不能用 `resolve('<name>/package.json')`：现代包（`clsx` 这类）的 `exports` 通常不暴露
 * `./package.json`，那样明明装着也解析不出来。
 */
export async function packageRootOf(from: string, name: string): Promise<PackageRoot | undefined> {
  const bare = name.split("/").slice(0, name.startsWith("@") ? 2 : 1).join("/");
  // 虚拟模块的 id（`\0…`）不是路径：`createRequire` 拿到它会抛，直接跳过这层解析。
  const require = from.startsWith("\0") ? undefined : createRequire(from);
  try {
    if (require === undefined) throw new Error("virtual id: 不走 node 解析");
    // 只解析**包名**：带子路径的说明符（`pkg/sub`）会要求清单里有对应 `exports` 键，而我们要的是包根。
    const resolved = require.resolve(bare);
    const owned = await owningPackageOf(resolved);
    if (owned !== undefined) return owned;
  } catch {
    // 落到下面的候选目录：**没有 `.` 出口**的包（`@oxc-project/runtime` 只有 `./helpers/*`）解析不了
    // 包名本身，明明装着却"解析不到"。
  }
  for (const directory of require?.resolve.paths(bare) ?? []) {
    const manifest = join(directory, bare, "package.json");
    if (await readFile(manifest, "utf8").then(() => true, () => false)) {
      const owned = await owningPackageOf(manifest);
      if (owned !== undefined) return owned;
    }
  }
  const root = (await workspaceIndexOf(from)).get(name);
  return root === undefined ? undefined : await owningPackageOf(join(root, "package.json"));
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
      main?: string;
      module?: string;
    };
    const key = subpath === undefined ? "." : `./${subpath}`;
    // `exports` 的三种形状（都要认）：
    // · 以 `.` 开头的键映射（标准）→ 取 `exports["."]` / `exports["./sub"]`；
    // · **条件对象本身**（`{ development, default }`，`mdast-util-*` 就是这形状）→ 它**就是**根出口；
    // · 没有 `exports` → 按 node 规则退回 `module` → `main`（老包如 `fortune-sheet`）。
    const table = manifest.exports;
    const isSubpathMap =
      table !== undefined && Object.keys(table).some((name) => name === "." || name.startsWith("./"));
    const entry =
      (isSubpathMap ? table?.[key] : key === "." ? table : undefined) ??
      (key === "." ? (manifest.module ?? manifest.main) : undefined);
    const target =
      typeof entry === "string"
        ? entry
        : entry === null || typeof entry !== "object"
          ? undefined
          : // 条件按**运行期**优先级挑：`import`（ESM 入口，`"type": "module"` 的包都走它）→
            // `default` → `require`。`types` 是类型声明（`index.d.ts`），拿它去打包会得到 3460 个
            // PARSE_ERROR——rolldown 把声明文件当 JS 解析，所以它只能垫底。
            pickCondition(entry as Record<string, unknown>);
    if (typeof target !== "string") return undefined;
    return resolveInPackage({ name: "", version: "", root }, target.replace(/^\.\//u, ""));
  } catch {
    return undefined;
  }
}

/** 包清单里我们用到的那些字段（其余原样留着，调用方按需读）。 */
export interface PackageManifest {
  name: string;
  version: string;
  /** `dsh.client` 声明：有它才是 client 行（上游 `client-modules` 的 roster 判据）。 */
  dsh?: { client?: unknown };
  exports?: Record<string, unknown>;
  main?: string;
  module?: string;
}

/** 读包清单。 */
export async function manifestOf(root: string): Promise<PackageManifest | undefined> {
  try {
    const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as Partial<PackageManifest>;
    if (manifest.name === undefined) return undefined;
    return { ...manifest, name: manifest.name, version: manifest.version ?? "0" };
  } catch {
    return undefined;
  }
}

/** 向上找最近的包（软链已由 node 解析解开）：返回清单与包根。 */
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

/**
 * 包内**物理路径**回退：清单的 `exports` 没覆盖这个子路径时，按约定位置找文件。
 *
 * 老包很常见：`picomatch` 没有 `exports`、只有 `main`，而 `picomatch/posix` 就是 `posix.js`；
 * 只声明了部分子路径的包同理。寻址按 URL 来（`<pkg>@<version>/<子路径>.js`），所以这里按子路径找文件。
 */
export async function fileInPackage(root: string, subpath: string): Promise<string | undefined> {
  const pkg = { name: "", version: "", root };
  for (const candidate of [
    subpath,
    `${subpath}.js`,
    `${subpath}.mjs`,
    join(subpath, "index.js"),
    join(subpath, "index.mjs"),
    join(subpath, "index.ts"),
  ]) {
    const file = resolveInPackage(pkg, candidate);
    if (file !== undefined && (await readFile(file, "utf8").then(() => true, () => false))) return file;
  }
  return undefined;
}

/** 一个 specifier 的寻址结果：包名、包内路径、以及它对应的 URL。 */
export interface ResolvedSpecifier {
  name: string;
  filepath: string;
  url: string;
}




/**
 * 说明符里的包名：`@scope/name` 取两段、`name` 取一段。作用域包**没有子路径**时，
 * `indexOf("/", slash + 1)` 会返回 -1——直接 `slice` 会削掉最后一个字符，这里显式判掉。
 */
export function packageNameOf(specifier: string): string {
  if (!specifier.startsWith("@")) return specifier.split("/")[0] ?? specifier;
  const slash = specifier.indexOf("/");
  if (slash < 0) return specifier;
  const second = specifier.indexOf("/", slash + 1);
  return second < 0 ? specifier : specifier.slice(0, second);
}





/**
 * 包根 → 它**浏览器面**的文件。
 *
 * @param root - 包根目录。
 * @param subpath - 出口名（不含包名，如 `client`、`brand-font.css`）；省略表示包的根出口。
 * @returns 该出口对应的文件；清单没这个出口、且约定路径也不存在时返回 undefined。
 */
export async function clientHalfOf(root: string, subpath?: string): Promise<string | undefined> {
  const exists = async (file: string): Promise<boolean> => await readFile(file, "utf8").then(() => true, () => false);
  if (subpath !== undefined) {
    const byExports = await exportTargetOf(root, subpath);
    if (byExports !== undefined) return byExports;
    // 清单没覆盖的按物理路径试（`src/<subpath>/index.ts` 是 client 半的约定位置）。
    const pkg = { name: "", version: "", root };
    for (const candidate of [join("src", subpath, "index.ts"), join(subpath, "index.ts"), subpath]) {
      const file = resolveInPackage(pkg, candidate);
      if (file !== undefined && (await exists(file))) return file;
    }
    return undefined;
  }
  // 根出口：`dsh.client` 声明的包用它的 `./client`；其余用约定路径 `src/client/index.ts`。
  const byClient = await exportTargetOf(root, "client");
  if (byClient !== undefined) return byClient;
  const conventional = join(root, "src", "client", "index.ts");
  return (await exists(conventional)) ? conventional : undefined;
}
