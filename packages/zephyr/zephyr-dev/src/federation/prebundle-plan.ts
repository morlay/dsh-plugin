// 构建期预编译的**清单枚举**：从应用 client 入口递归静态 import，收集"页面会用到哪些包"。
//
// 为什么不从 dist 反推：build 的静态面走 vite/rollup 常规定制打包，产物里没有 /_zephyr/@modules/…
// （那是 dev 期 dshClientPlugin 的改写结果），从 dist 反推永远得到空清单。
//
// 取舍（v1）：只认**静态** import（import … from / export … from / 副作用 import "x"，import type 跳过），
// 用正则扫描而不是 rolldown 的 parseAst——v1 目标是"清单不为空且覆盖已知包"，动态 import 与
// tsconfig paths 留给后续版本（见包级设计）。
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { PrebundleTarget } from "./prebundle.ts";

/** 枚举输入。 */
export interface PrebundlePlanOptions {
  /** 应用 client 入口（app-boot.ts）绝对路径。 */
  readonly entry: string;
  /** 应用的 package.json（解析基准）。 */
  readonly appManifest: string;
  /** clientModules.include（glob）；空或缺省 = 图里全部包。 */
  readonly include?: readonly string[];
}

/** 枚举结果。 */
export interface PrebundlePlan {
  /** 待预编译目标。 */
  readonly targets: readonly PrebundleTarget[];
  /** 解析不到入口的包（不静默，交给调用方判红）。 */
  readonly failures: readonly { readonly name: string; readonly reason: string }[];
}

/** 包内被视为「client 面」的出口（按顺序逐个试）。 */
const CLIENT_EXPORTS = ["./client", "./ui", "./client-module", "./index"];

/** 动态 grammar 家族：它们的 `exports` 子路径（`./*`）要逐个预编译，不能只取 client 面。 */
const DYNAMIC_FAMILY = /^(shiki|@shikijs\/)/u;

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

/**
 * 枚举待预编译目标。
 * @param options - 入口、清单与 include。
 * @returns 目标清单与失败明细。
 */
export async function planPrebundle(options: PrebundlePlanOptions): Promise<PrebundlePlan> {
  const appRequire = createRequire(options.appManifest);
  const pending = [options.entry];
  const seenFiles = new Set<string>();
  const packages = new Set<string>();
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || seenFiles.has(file) || !/\.[cm]?[jt]sx?$/u.test(file)) continue;
    seenFiles.add(file);
    const text = await readFile(file, "utf8").catch(() => "");
    for (const specifier of bareImportsOf(text)) {
      if (specifier.startsWith("node:")) continue;
      packages.add(packageNameOfSpecifier(specifier));
    }
    for (const match of text.matchAll(RELATIVE_FROM)) {
      const relative = match[1];
      if (relative === undefined) continue;
      const base = join(dirname(file), relative).replace(/\.[cm]?[jt]sx?$/u, "");
      pending.push(base + ".ts", base + ".tsx");
    }
  }
  const include = options.include ?? [];
  const wanted =
    include.length === 0
      ? [...packages]
      : [...packages].filter((name) =>
          include.some((pattern) => {
            const prefix = pattern.replace(/\*+$/u, "");
            return prefix === "" ? true : name.startsWith(prefix);
          }),
        );
  const targets: PrebundleTarget[] = [];
  const failures: { name: string; reason: string }[] = [];
  for (const name of wanted) {
    const manifestOf = (() => {
      try {
        return appRequire.resolve(name + "/package.json");
      } catch {
        return undefined;
      }
    })();
    if (manifestOf === undefined) {
      failures.push({ name, reason: "解析不到 package.json" });
      continue;
    }
    const version = (JSON.parse(await readFile(manifestOf, "utf8")) as { version?: string })
      .version;
    if (version === undefined) {
      failures.push({ name, reason: "清单里没有 version" });
      continue;
    }
    const exportsTable = DYNAMIC_FAMILY.test(name)
      ? Object.keys(
          (JSON.parse(await readFile(manifestOf, "utf8")) as { exports?: Record<string, unknown> })
            .exports ?? {},
        ).filter((key) => key.startsWith("./") && key !== "./package.json")
      : [];
    const subpaths = exportsTable.length > 0 ? exportsTable : CLIENT_EXPORTS;
    let planned = false;
    for (const subpath of subpaths) {
      const exportName = subpath === "./index" ? "index" : subpath.slice(2).replace(/\/$/u, "");
      const specifier = subpath === "./index" ? name : name + "/" + exportName;
      const entry = (() => {
        try {
          return appRequire.resolve(specifier);
        } catch {
          return undefined;
        }
      })();
      if (entry === undefined) continue;
      targets.push({ name, version, exportName, entry, manifestOf });
      planned = true;
    }
    if (!planned) failures.push({ name, reason: "没有可用的 client 出口" });
  }
  return { targets, failures };
}
