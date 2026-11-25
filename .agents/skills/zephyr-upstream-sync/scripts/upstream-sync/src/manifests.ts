import { glob, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse } from "oxc-parser";
import { pathExists } from "./common.ts";

// `json` 步骤：按 glob 找到上游的 JSON 清单，**整块删掉**指定字段。
//
// 结构化改动（读 JSON、`delete` 字段、写回），不切文本：正则删 `devDependencies` 必然踩到 JSON
// 的逗号与缩进（上游清单的空格写法并不统一），而少一个逗号就是整棵树解析失败。
//
// 目前唯一的用法是删上游各包 `package.json` 的 `devDependencies`。为什么删：
//
// - `pnpm-workspace.yaml` 把上游包纳进 workspace（`vendor/deepseek-harness/packages/*/*` 等），于是它们
//   自带的 devDeps 参与 install，制造大量循环 / peer 警告；
// - 我们**从不跑上游的 lint / test**（`just lint` / `just test` 都带 `--filter='!./vendor/**'`，见 AGENTS.md
//   的上游只读红线），那些工具对我们没有用途。
//
// 删之前有一段**认领**（`rescueImportedDependencies`）：上游把 client 半的运行期依赖（`clsx`、`shiki`、
// `katex` 这类浏览器依赖）写在 `devDependencies` 里，由它自己的打包内联；而本仓库这条链是运行期现场打包、
// 真会 import 它们。所以源码里 import 到的条目先并进 `dependencies`，再整段删。
// `peerDependencies` / `optionalDependencies` / `scripts` 一个字不动：前两个是运行期契约。
/** `json` 步骤的参数（与 `vendor/steps.ts` 里的步骤字段一一对应）。 */
export type JsonDropOptions = {
  /** 相对上游根的 glob（`node_modules` 永不进范围）。 */
  glob: string;
  /** 要整块删掉的顶层字段；不存在即跳过（幂等）。 */
  drop: string[];
};

/** 相对 / 绝对 / 虚拟 / node 内置之外的裸说明符——**该由包管理器解析**的那些。 */
function isBareSpecifier(specifier: unknown): specifier is string {
  return (
    typeof specifier === "string" &&
    specifier !== "" &&
    !specifier.startsWith(".") &&
    !specifier.startsWith("/") &&
    !specifier.startsWith("\0") &&
    !specifier.startsWith("node:")
  );
}

/** 说明符 → 包名：`@scope/name/sub` → `@scope/name`；`katex/dist/katex.min.css` → `katex`。 */
function packageNameOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}

/**
 * 一棵源码树里 import 到的全部**包名**。
 *
 * 判据是 AST，不是正则：`import` / `export … from` / `import()` / `require()` / `import.meta.resolve()`
 * 五种写法都要认（相对路径之外的裸说明符**就是依赖**）。用 oxc 的解析器——它是这个包自己的依赖。
 */
export async function importedPackagesOf(dir: string): Promise<Set<string>> {
  const found = new Set<string>();
  const walk = async (path: string): Promise<void> => {
    for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) {
        await walk(child);
        continue;
      }
      if (!/\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/u.test(entry.name)) continue;
      const { program } = await parse(child, await readFile(child, "utf8"));
      const visit = (node: unknown): void => {
        if (node === null || typeof node !== "object") return;
        if (Array.isArray(node)) {
          for (const item of node) visit(item);
          return;
        }
        const record = node as Record<string, unknown>;
        if (
          record["type"] === "ImportDeclaration" ||
          record["type"] === "ExportNamedDeclaration" ||
          record["type"] === "ExportAllDeclaration" ||
          record["type"] === "ImportExpression"
        ) {
          const source = (record["source"] as { value?: unknown } | undefined)?.value;
          if (isBareSpecifier(source)) found.add(packageNameOf(source));
        }
        if (record["type"] === "CallExpression") {
          const callee = record["callee"] as
            | { name?: unknown; property?: { name?: unknown } }
            | undefined;
          const first = (record["arguments"] as { value?: unknown }[] | undefined)?.[0];
          // `require("x")` 与 `import.meta.resolve("x")`（后者长成 `(<import.meta>).resolve(...)`）。
          if (
            (callee?.name === "require" || callee?.property?.name === "resolve") &&
            isBareSpecifier(first?.value)
          ) {
            found.add(packageNameOf(first.value));
          }
        }
        for (const value of Object.values(record)) visit(value);
      };
      visit(program);
    }
  };
  await walk(dir);
  return found;
}

/** 记录是不是一个普通的对象（清单字段的判据：`null` / 数组都不算）。 */
function isRecordOf(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * 认领：把 `devDependencies` 里**被源码 import 到**的条目并进 `dependencies`。
 *
 * @param manifest - 该包的清单（就地改）。
 * @param pkgDir - 包目录（扫它的 `src/`）。
 * @returns 认领了几条。
 */
async function rescueImportedDependencies(
  manifest: Record<string, unknown>,
  pkgDir: string,
): Promise<number> {
  const dev = manifest["devDependencies"];
  if (!isRecordOf(dev)) return 0;
  const entries = Object.entries(dev);
  if (entries.length === 0) return 0;
  const srcDir = join(pkgDir, "src");
  // 没有源码的包（只发 bin、只有 native 源）没有运行期 import 可认领。
  if (!(await pathExists(srcDir))) return 0;
  const used = await importedPackagesOf(srcDir);
  const rescued: Record<string, unknown> = {};
  for (const [name, range] of entries) {
    if (used.has(name)) rescued[name] = range;
  }
  const names = Object.keys(rescued);
  if (names.length === 0) return 0;
  const dependencies = manifest["dependencies"];
  manifest["dependencies"] = { ...(isRecordOf(dependencies) ? dependencies : {}), ...rescued };
  return names.length;
}

/**
 * `json` 步骤的实现：删掉匹配文件里指定的顶层字段（整块删，不留空对象）。
 *
 * 幂等：字段不存在就不改、不写盘（第二次跑不会重排 JSON、也不会动一个字节）。
 *
 * @param root - 上游根目录。
 * @param options - glob 与要删的字段。
 */
export async function dropJsonFields(root: string, options: JsonDropOptions): Promise<void> {
  let changed = 0;
  let rescued = 0;
  for await (const entry of glob(options.glob, {
    cwd: root,
    exclude: (path) => path.includes("node_modules"),
  })) {
    const file = join(root, entry);
    const before = await readFile(file, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(before);
    } catch {
      throw new Error(`不是合法 JSON: ${entry}（先查上游是否改坏了这文件）`);
    }
    if (!isRecordOf(parsed)) continue;
    let touched = false;
    for (const field of options.drop) {
      if (!(field in parsed)) continue;
      // 「认领」只对 `devDependencies` 有意义：见文件头的说明。
      if (field === "devDependencies")
        rescued += await rescueImportedDependencies(parsed, dirname(file));
      delete parsed[field];
      touched = true;
    }
    if (!touched) continue;
    await writeFile(file, `${JSON.stringify(parsed, null, 2)}\n`);
    changed += 1;
  }
  console.log(
    `[steps] json ${options.glob}: ${changed} 份清单删了 ${options.drop.join(" / ")}` +
      (rescued > 0 ? `，其中认领 ${rescued} 条被源码 import 的依赖进 dependencies` : ""),
  );
}
