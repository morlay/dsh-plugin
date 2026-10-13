import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve as resolvePath, sep } from "node:path";


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
  // combo（`??a,b`）、我们自己的入口（`.app/entry.js`）都不是按包寻址。
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
 * 包名 → 包根：走 node 的解析（pnpm 已经把依赖摆好了），**解析入口**再向上找最近的清单。
 *
 * 不能用 `resolve('<name>/package.json')`：现代包（`clsx` 这类）的 `exports` 通常不暴露
 * `./package.json`，那样明明装着也解析不出来。
 */
export async function packageRootOf(from: string, name: string): Promise<PackageRoot | undefined> {
  try {
    const require = createRequire(from);
    // 只解析**包名**：带子路径的说明符（`pkg/sub`）会要求清单里有对应 `exports` 键，而我们要的是包根。
    return await owningPackageOf(require.resolve(name.split("/").slice(0, name.startsWith("@") ? 2 : 1).join("/")));
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
 * 目标入口是不是 **CJS-only**——决定跨包引用该交给谁处理。
 *
 * CJS 对外置依赖是**同步** `require`，必须由 `esmExternalRequirePlugin` 认包名转成 import（转完那份
 * facade 的 `import` 说明符再由我们的 rewrite 落成统一 URL）。**不能** inline：`react` 这类被多处引用，
 * inline 会在每份产物里各留一份实例，hook 分发就冲突。
 */
export function isCjsOnlySource(source: string): boolean {
  return source.includes("module.exports") || source.includes("exports.");
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
