// 运行期依赖的静态探查：从包的**入口**（`exports` / client 半）出发，沿 import 图收集裸包名，
// 再逐个试着解析——**解析不到的就是运行期会缺的**。
//
// 为什么需要它：上游的规矩是"client 半的浏览器依赖（`katex`、`clsx` 这类）算 `devDependencies`，构建时被
// 内联"，所以它们在**生产安装（`pnpm deploy --prod`）里不存在**；而这条链是运行期现场打包，真去 import 它们
// ——于是只有到了打包形态才炸（dev 形态的 profile 是工作区，恰好有）。这个探查让同一个问题在 **dev 阶段**
// 就能定位：一条命令、秒级（用 oxc 的解析器，不用 tsc）。
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { parse } from "oxc-parser";

/** 一条"这个包运行期要它"的记录。 */
export interface RuntimeDependency {
  /** 裸包名（`katex`、`@shikijs/langs`…；子路径已归到包名）。 */
  readonly name: string;
  /** 从哪里走到的（相对探查根，便于定位）。 */
  readonly from: string;
}

/** 从说明符取出包名：`@scope/name/sub` → `@scope/name`，`katex/dist/x.css` → `katex`。 */
export function packageNameOfSpecifier(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}

/** 是不是"该由包管理器解析"的说明符（相对 / 绝对 / 虚拟 / node 内置都不算）。 */
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

/** 一份源码里出现的全部裸说明符（`import` / `export … from` / `import()` / `require()`）。 */
async function bareSpecifiersOf(file: string): Promise<string[]> {
  const { program } = await parse(file, await readFile(file, "utf8"));
  const found: string[] = [];
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const record = node as Record<string, unknown>;
    const source = (record["source"] as { value?: unknown } | undefined)?.value;
    if (
      (record["type"] === "ImportDeclaration" ||
        record["type"] === "ExportNamedDeclaration" ||
        record["type"] === "ExportAllDeclaration" ||
        record["type"] === "ImportExpression") &&
      isBareSpecifier(source)
    ) {
      found.push(source);
    }
    if (record["type"] === "CallExpression") {
      const callee = record["callee"] as { name?: unknown; property?: { name?: unknown } } | undefined;
      const first = (record["arguments"] as { value?: unknown }[] | undefined)?.[0];
      // `require("x")` 与 `import.meta.resolve("x")`：后者长成 `(<import.meta>).resolve(...)`。
      if (
        (callee?.name === "require" || callee?.property?.name === "resolve") &&
        isBareSpecifier(first?.value)
      ) {
        found.push(first.value);
      }
    }
    for (const value of Object.values(record)) visit(value);
  };
  visit(program);
  return found;
}

/** 一个目录下所有源码文件。 */
async function sourceFilesOf(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/\.(?:ts|tsx|mts|js|mjs)$/u.test(entry.name)) found.push(path);
    }
  };
  if ((await stat(root).catch(() => undefined))?.isDirectory() !== true) return found;
  await walk(root);
  return found;
}

/**
 * 扫一个包的**运行期依赖**：从 `exports` 指到的入口所在目录出发（`src` 之类），沿 import 图收集裸包名。
 *
 * 只做**一层**（不进依赖自己的入口）：上游 client 半的运行期依赖几乎都写在它自己的源码里；要更准就把每个
 * 依赖也照同一套递归下去——那会把整棵图扫一遍，需要时再开。
 *
 * @param root - 包根目录。
 * @returns 按包名去重的依赖列表（含 `from`，指出在哪个文件看见的）。
 */
export async function runtimeDependenciesOf(root: string): Promise<RuntimeDependency[]> {
  const seen = new Map<string, string>();
  for (const file of await sourceFilesOf(join(root, "src"))) {
    for (const specifier of await bareSpecifiersOf(file)) {
      const name = packageNameOfSpecifier(specifier);
      if (!seen.has(name)) seen.set(name, relative(root, file));
    }
  }
  return [...seen].map(([name, from]) => ({ name, from })).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 这些依赖里，哪些**没有任何包声明**（不在任何 `dependencies` / `peerDependencies` 里）。
 *
 * **单包视角**（批量交给 `pnpm -r exec`，别在这里扫全仓）：判据是"**这个包自己声明了吗**"。
 *
 * 判据不是"能不能 require"（那是运行期解析，另一回事）：自己声明了 → 有归属、能补进闭包；没声明 →
 * 多半是上游把运行期依赖放进了 `devDependencies`（`clsx`、`shiki` 这类"构建时内联、生产安装里没有"的），
 * 运行期一定缺——**直接抛错**，别让它到打包/浏览器才现形。
 *
 * @param manifest - 这个包自己的清单。
 * @param dependencies - 扫出来的依赖。
 * @returns 未声明的依赖名（按扫出来的顺序）。
 */
export function undeclaredDependencies(
  manifest: { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> } | undefined,
  dependencies: readonly RuntimeDependency[],
): string[] {
  const declared = new Set<string>([
    ...Object.keys(manifest?.dependencies ?? {}),
    ...Object.keys(manifest?.peerDependencies ?? {}),
  ]);
  return dependencies.map(({ name }) => name).filter((name) => !declared.has(name));
}

/** 供 CLI 用：扫 + 报（缺的单独一行）。 */
export async function reportRuntimeDependencies(root: string): Promise<string[]> {
  const dependencies = await runtimeDependenciesOf(root);
  const manifest = await readFile(join(root, "package.json"), "utf8").then(
    (text) => JSON.parse(text) as { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> },
    () => undefined,
  );
  const missing = undeclaredDependencies(manifest, dependencies);
  process.stdout.write(
    `${root}: 运行期依赖 ${String(dependencies.length)} 个` +
      `${missing.length === 0 ? "（都可解析）" : `，其中**解析不到** ${String(missing.length)} 个`}\n`,
  );
  for (const { name, from } of dependencies) {
    const flag = missing.includes(name) ? "✗" : "✓";
    process.stdout.write(`  ${flag} ${name} ← ${from}\n`);
  }
  return missing;
}
