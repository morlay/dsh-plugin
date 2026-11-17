// 构建期预编译的**清单枚举**：从应用 client 入口递归静态 import，收集"页面会用到哪些包"。
//
// 为什么不从 dist 反推：build 的静态面走 vite/rollup 常规定制打包，产物里没有 /_zephyr/@modules/…
// （那是 dev 期 dshClientPlugin 的改写结果），从 dist 反推永远得到空清单。
//
// 取舍（v1）：只认**静态** import（import … from / export … from / 副作用 import "x"，import type 跳过），
// 用正则扫描而不是 rolldown 的 parseAst。动态 `import("…")` 也收：grammar / 语言包只在运行时按需加载，
// 光看静态图会漏（`@shikijs/langs/typescript` 就是）。
//
// 两条基准事实（改动都从这里来）：
// 1. **解析基准是引用方**，不是应用清单：`shiki` 只装在
//    `@deepseek-ai/dsh-client-ui-primitives/node_modules` 里，从应用清单出发根本解析不到它——
//    不是因为不在盘上（`pnpm deploy` 会沿依赖图把它装进闭包），而是因为应用清单没声明它。
//    所以包根按「它第一次被哪个文件引用」向上找，与 `federation.service` 的 `rootOf` 同源
//    （`node:module` 的 `findPackageJSON`）。
// 2. **下潜范围**是 `@morlay/*` 与上游 client 面 `@deepseek-ai/dsh-client*`：shiki 的真实来源链是
//    `@morlay/zephyr-ui` → `dsh-client-ui-primitives` → `src/markdown/highlight.ts` 的 `import "shiki/core"`，
//    不下潜到第二段就停在 `@morlay` 边界上。
//
// 目标按**实际见到的说明符**出，不按 `exports` 全枚举：`@shikijs/langs` 有 361 个子路径，
// 全枚举会把清单撑爆、构建时间爆炸；源码里写的是 `@shikijs/langs/typescript`，那就只出 `typescript` 这一个出口。
// 同一个包的不同子路径仍各自出 target（`shiki/core` 与包根是不同入口）。
import { readFile, realpath } from "node:fs/promises";
import { findPackageJSON } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { browserEntryOf } from "./bundle.ts";
import type { PrebundleTarget } from "./prebundle.ts";

/** 枚举输入。 */
export interface PrebundlePlanOptions {
  /** 应用 client 入口（app-boot.ts）绝对路径。 */
  readonly entry: string;
  /** clientModules.include（glob）；空或缺省 = 图里全部包。 */
  readonly include?: readonly string[];
}

/** 枚举结果。 */
export interface PrebundlePlan {
  /** 待预编译目标。 */
  readonly targets: readonly PrebundleTarget[];
  /** 该有却没有的包（下潜过的包一个出口都解析不出来；不静默，交给调用方判红）。 */
  readonly failures: readonly { readonly name: string; readonly reason: string }[];
}

/** 包内被视为「浏览器面」的出口（下潜时按顺序逐个试，解析得开才进 BFS）。 */
const CLIENT_EXPORTS = ["./client", "./ui", "./client-module", "./index"];

/**
 * 要**下潜读源码**的包。
 *
 * `@morlay/*` 是我们的包（它们的 `exports` 直接指 TS 源码）；`@deepseek-ai/dsh-client*` 是上游的
 * client 面——shiki 就在这条链的末端。其余包只记说明符，不读它们的源码（三方包的体积与源码形态不可控）。
 */
const DESCEND = /^(?:@morlay\/|@deepseek-ai\/dsh-client)/u;

/** 每个包最多记几个引用方：解析包根时按顺序试（第一个解析得开的就是它实际被引用的那一份）。 */
const MAX_IMPORTERS = 4;

/** 静态 import 语句的正则（跳过 import type）。 */
const STATIC_FROM =
  /(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^;]*?from\s*["']([^"'.][^"']*)["']/gu;

/** 副作用 import 的正则。 */
const SIDE_EFFECT = /(?:^|\n)\s*import\s*["']([^"'.][^"']*)["']/gu;

/** 动态 import 的正则（`import("pkg")`）：grammar / 语言包这类按需加载的说明符。 */
const DYNAMIC_IMPORT = /import\s*\(\s*["']([^"'.][^"']*)["']\s*\)/gu;

/** 相对导入的正则（继续跟下去）。 */
const RELATIVE_FROM = /from\s*["'](\.{1,2}\/[^"']+)["']/gu;

/**
 * 从源码里取**静态** import 的裸说明符。
 * @param text - 源码。
 * @returns 说明符列表。
 */
export function bareImportsOf(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(STATIC_FROM)) {
    const specifier = match[1];
    if (specifier !== undefined) out.push(specifier);
  }
  for (const match of text.matchAll(SIDE_EFFECT)) {
    const specifier = match[1];
    if (specifier !== undefined) out.push(specifier);
  }
  // 动态 import 的裸说明符也收：grammar / 语言包只在运行时按需加载，光看静态图会漏（shiki 就是）。
  for (const match of text.matchAll(DYNAMIC_IMPORT)) {
    const specifier = match[1];
    if (specifier !== undefined) out.push(specifier);
  }
  return out;
}

/**
 * 裸说明符 → 包名。
 * @param specifier - 说明符（@scope/name/sub 或 name/sub）。
 * @returns 包名。
 */
export function packageNameOfSpecifier(specifier: string): string {
  return specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : (specifier.split("/")[0] ?? specifier);
}

/** 一个包的解析结果：真实包根与它的清单（外置依赖的版本表从这里建）。 */
interface PackageRoot {
  /** 包根（软链已解开）。 */
  readonly root: string;
  /** 清单绝对路径。 */
  readonly manifest: string;
}

/**
 * 包名 → 包根：按**引用方**解析（node 的规则），第一个解析得开的引用方说了算。
 *
 * 用 `findPackageJSON` 而不是 `createRequire(appManifest).resolve(name + "/package.json")`：
 * 后者的基准是应用清单，从它出发看不到「只在别人 node_modules 里」的包（shiki 就是），而且
 * 现代包的 `exports` 常常不暴露 `./package.json`——明明装着也解析不出来。这条面与
 * `federation.service` 的 `rootOf` / `internal/resolve` 的 `packageRootOf` 同源。
 *
 * 软链解到真实路径：随后 `createRequire(清单)` 要按真实位置向上找它的兄弟依赖（pnpm 把同一个包的
 * 依赖摆在 `.pnpm/<pkg>@<ver>/node_modules` 里，软链路径那一侧的上级目录里没有）。
 * @param name - 包名。
 * @param importers - 引用过它的文件（按 BFS 顺序，第一个可能是脏数据源）。
 * @returns 包根；都解析不到时 `undefined`。
 */
async function packageRootOf(
  name: string,
  importers: readonly string[],
): Promise<PackageRoot | undefined> {
  for (const importer of importers) {
    const found = (() => {
      try {
        return findPackageJSON(name, pathToFileURL(importer).href);
      } catch {
        return undefined;
      }
    })();
    if (found === undefined) continue;
    const manifest = await realpath(found).catch(() => found);
    return { root: dirname(manifest), manifest };
  }
  return undefined;
}

/**
 * 按**引用方目录**解析包根（带缓存：同一目录的解析结果相同）。
 * @param name - 包名。
 * @param importer - 引用它的文件。
 * @param cache - 解析结果缓存（键是 `包名::引用方目录`）。
 * @returns 包根；解析不到时 `undefined`。
 */
async function rootOfFrom(
  name: string,
  importer: string,
  cache: Map<string, PackageRoot | undefined>,
): Promise<PackageRoot | undefined> {
  const key = `${name}::${dirname(importer)}`;
  if (cache.has(key)) return cache.get(key);
  const root = await packageRootOf(name, [importer]);
  cache.set(key, root);
  return root;
}

/**
 * 一个说明符在**这份副本**里的入口：规则只有一份（`bundle.ts` 的 {@link browserEntryOf}）。
 *
 * 不能用 `createRequire(manifest).resolve(specifier)`：那是 `require` 条件，双面入口的包会拿到
 * UMD/CJS 那份（`katex` 的 `dist/katex.js`）——枚举选哪一份、产物就编哪一份字节，两处各写一套规则
 * 迟早漂（dev 服务面与 build 面于是各拿一份，缓存还会互相判失效）。
 * @param manifest - 解析基准（这份副本自己的清单）。
 * @param specifier - 说明符（`pkg` 或 `pkg/sub`）。
 * @returns 入口绝对路径；解析不到时 `undefined`。
 */
async function entryOf(manifest: string, specifier: string): Promise<string | undefined> {
  const bare = packageNameOfSpecifier(specifier);
  const subpath = specifier === bare ? undefined : specifier.slice(bare.length + 1);
  return await browserEntryOf(dirname(manifest), subpath);
}

/**
 * 包清单里的 `version`（不是包就不算）。
 * @param manifest - 清单绝对路径。
 * @returns 版本号；读不到或没有 `version` 时 `undefined`。
 */
async function versionOf(manifest: string): Promise<string | undefined> {
  const parsed = JSON.parse(await readFile(manifest, "utf8").catch(() => "{}")) as {
    version?: unknown;
  };
  return typeof parsed.version === "string" ? parsed.version : undefined;
}

/**
 * 一个包的**浏览器面**入口：下潜时读哪些文件。
 *
 * 按 `exports` 的 `./client` / `./ui` / `./client-module` / `./index` 逐个试，解析得开的全收——
 * 一个包的 client 半与宿主半可能都要看（根引用与子路径引用在不同引用方里并存）。
 * @param root - 包根。
 * @param name - 包名。
 * @returns 入口文件（只收 JS/TS，CSS 不进 BFS）。
 */
async function browserEntriesOf(root: PackageRoot, name: string): Promise<string[]> {
  const out: string[] = [];
  for (const subpath of CLIENT_EXPORTS) {
    const specifier = subpath === "./index" ? name : `${name}/${subpath.slice(2)}`;
    // 下潜与出目标用**同一个**入口（{@link entryOf}）：读 `.cjs` 那份就只看得见 require 树上的依赖。
    const entry = await entryOf(root.manifest, specifier);
    if (entry !== undefined && /\.[cm]?[jt]sx?$/u.test(entry)) out.push(entry);
  }
  return out;
}

/**
 * 枚举待预编译目标。
 * @param options - 入口与 include。
 * @returns 目标清单与该有却没有的包。
 */
export async function planPrebundle(options: PrebundlePlanOptions): Promise<PrebundlePlan> {
  const pending = [options.entry];
  const seenFiles = new Set<string>();
  /**
   * 一条记录 = **一份真实副本**（它的包根清单）。
   *
   * 键必须是清单路径而不是包名：pnpm 的严格布局下同名多版本各有一份（`katex` 0.16 与 0.18 同时存在），
   * 按包名键会把它们塌成一条——产物里只出一个版本，另一个版本的地址永远 404，而构建是绿的。
   */
  const records = new Map<
    string,
    {
      readonly name: string;
      readonly version: string;
      /** 这份副本的包根清单（键就是它，读出来省得再解析一次）。 */
      readonly manifestOf: string;
      readonly importers: string[];
      readonly specifiers: Set<string>;
    }
  >();
  /** `包名::引用方目录` → 解析结果（同一目录的解析结果相同，别对每个说明符都走一遍查找）。 */
  const rootCache = new Map<string, PackageRoot | undefined>();
  /** 已经下潜过的包名（下潜读源码只做一次：client 入口是哪个文件与版本无关）。 */
  const descended = new Set<string>();
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || seenFiles.has(file) || !/\.[cm]?[jt]sx?$/u.test(file)) continue;
    seenFiles.add(file);
    const text = await readFile(file, "utf8").catch(() => "");
    const specifiers = bareImportsOf(text).filter((specifier) => !specifier.startsWith("node:"));
    for (const specifier of specifiers) {
      const name = packageNameOfSpecifier(specifier);
      const root = await rootOfFrom(name, file, rootCache);
      // **解析不到就不是包**：正则会从 CSS 片段、模板字符串、文档里扫出假包名。判据是解析事实，不是名字长得像。
      if (root === undefined) continue;
      const version = await versionOf(root.manifest);
      if (version === undefined) continue;
      const record = records.get(root.manifest) ?? {
        name,
        version,
        manifestOf: root.manifest,
        importers: [],
        specifiers: new Set<string>(),
      };
      record.specifiers.add(specifier);
      if (record.importers.length < MAX_IMPORTERS) record.importers.push(file);
      records.set(root.manifest, record);
    }
    for (const match of text.matchAll(RELATIVE_FROM)) {
      const relative = match[1];
      if (relative === undefined) continue;
      const base = join(dirname(file), relative).replace(/\.[cm]?[jt]sx?$/u, "");
      pending.push(base + ".ts", base + ".tsx");
    }
    // 下潜：把下潜范围内、第一次见到的包的浏览器面入口推进 BFS。**以这个引用方为解析基准**——
    // 它看得见哪个副本，就用哪个副本（pnpm 严格布局下同名多版本是常态）。
    for (const name of new Set(specifiers.map(packageNameOfSpecifier))) {
      if (!DESCEND.test(name) || descended.has(name)) continue;
      descended.add(name);
      const root = await packageRootOf(name, [file]);
      if (root !== undefined) pending.push(...(await browserEntriesOf(root, name)));
    }
  }
  const include = options.include ?? [];
  const wanted = [...records.values()].filter(
    (record) =>
      include.length === 0 ||
      include.some((pattern) => {
        const prefix = pattern.replace(/\*+$/u, "");
        return prefix === "" ? true : record.name.startsWith(prefix);
      }),
  );
  const targets: PrebundleTarget[] = [];
  const failures: { name: string; reason: string }[] = [];
  for (const record of wanted) {
    const { name, version } = record;
    const manifestOf = record.manifestOf;
    const planned = new Set<string>();
    for (const specifier of record.specifiers) {
      const subpath = specifier.slice(name.length).replace(/^\//u, "");
      // 出口名就是引用里那一段：包级引用是 `index`（地址 `…/index.js`），
      // `shiki/core` 是 `core`、`@morlay/zephyr-app/client/base.css` 是 `client/base.css`
      // ——必须与 `urlOf` 生成的地址同形，否则产物在盘上、地址却落在空处。
      const exportName = subpath === "" ? "index" : subpath;
      if (planned.has(exportName)) continue;
      const entry = await entryOf(manifestOf, specifier);
      if (entry === undefined) continue;
      planned.add(exportName);
      targets.push({ name, version, exportName, entry, manifestOf });
    }
    // 只有**下潜过**的包才谈得上「该有却没有」：其余的（三方包）解析不出出口是预期结果。
    if (planned.size === 0 && descended.has(name)) {
      failures.push({ name, reason: "没有任何可用的出口" });
    }
  }
  return { targets, failures };
}
