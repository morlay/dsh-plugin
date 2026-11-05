#!/usr/bin/env node
// **单包**的结构性检查（由 `pnpm -r exec` 在包目录里跑）：只判本包能判的，输出一行 JSON 给汇总器。
//
//   - 面边界：本包内相对 import 的落点（root/ui/server 不许互相越界）；
//   - 声明未用：本包声明却没用到的 `@deepseek-ai/*`；
//   - 上游面：本包用到的上游包的 **面**（`pkg#host` / `pkg#client` / `pkg#remote`）——唯一化要跨包汇总。
//
// 目录遍历交给 pnpm（`--filter './packages/*/*'`），这里不自己找包。
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { parse } from "oxc-parser";
import {
  bridgeReason,
  isAllowedContractValueEdge,
  isContractOrEndpointFace,
  isTestPath,
  isUpstreamPackageRoot,
  keepReason,
} from "./rules.ts";

/** AST 节点（ESTree 形态）。 */
interface AstNode {
  readonly type: string;
  readonly [key: string]: unknown;
}

/**
 * 深度遍历 AST。
 * @param node 任意节点。
 * @param visit 命中回调。
 */
function walk(node: unknown, visit: (node: AstNode) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  if (node === null || typeof node !== "object") return;
  const typed = node as AstNode;
  if (typeof typed.type === "string") visit(typed);
  for (const [key, value] of Object.entries(typed)) {
    if (key === "type" || key === "parent") continue;
    walk(value, visit);
  }
}

/** 一个文件的引用。 */
interface FileImports {
  /** 文件路径（面归属与测试路径判定都读它）。 */
  readonly file: string;
  readonly static: ReadonlySet<string>;
  readonly dynamic: ReadonlySet<string>;
  readonly literals: ReadonlySet<string>;
  /** 上游值边（`import` / 再导出；`import type` / `export type` 不算）：`说明符  [import|export]`。 */
  readonly valueEdges: readonly string[];
  /** `(x as unknown) as T` 的处数（双断言）。 */
  readonly doubleAssert: number;
}

/**
 * 解析一个文件的模块引用。
 * @param file 文件路径。
 * @returns 三类说明符。
 */
async function importsOf(file: string): Promise<FileImports> {
  const text = await readFile(file, "utf8");
  if (file.endsWith(".css")) {
    const literals = new Set(
      [...text.matchAll(/@import\s+(?:url\()?["']([^"']+)["']/gu)].map((m) => m[1] ?? ""),
    );
    return {
      file,
      static: new Set(),
      dynamic: new Set(),
      literals,
      valueEdges: [],
      doubleAssert: 0,
    };
  }
  const { program } = await parse(file, text);
  const staticSpecs = new Set<string>();
  const dynamicSpecs = new Set<string>();
  const literals = new Set<string>();
  const valueEdges: string[] = [];
  let doubleAssert = 0;
  const textOf = (node: unknown): string | undefined => {
    if (node === null || typeof node !== "object") return undefined;
    const value = (node as { value?: unknown }).value;
    return typeof value === "string" ? value : undefined;
  };
  walk(program, (node) => {
    if (
      node.type === "ImportDeclaration" ||
      node.type === "ExportNamedDeclaration" ||
      node.type === "ExportAllDeclaration"
    ) {
      const spec = textOf(node["source"]);
      if (spec !== undefined) {
        staticSpecs.add(spec);
        // 值边：声明本身不是 `type`，且至少一个说明符不是 `type`；`import "x"` 这类副作用导入也算。
        const declarationKind = node["importKind"] ?? node["exportKind"];
        const specifiers =
          (node["specifiers"] as readonly Record<string, unknown>[] | undefined) ?? [];
        const hasValue = specifiers.some(
          (item) => (item["importKind"] ?? item["exportKind"]) !== "type",
        );
        if (declarationKind !== "type" && (hasValue || specifiers.length === 0)) {
          valueEdges.push(
            spec + "  [" + (node.type === "ImportDeclaration" ? "import" : "export") + "]",
          );
        }
      }
      return;
    }
    // 双断言 `x as unknown as T`（含带括号的 `(x as unknown) as T`）：外层断言的被断言表达式本身
    // 是一次指向 `unknown` 的断言。括号在 AST 里是一层 `ParenthesizedExpression`，先剥掉再判——
    // 不剥的话带括号的写法能绕过判据。
    if (node.type === "TSAsExpression") {
      type Assertion = {
        type?: string;
        typeAnnotation?: { type?: string };
        expression?: Assertion;
      };
      const inner = node["expression"] as Assertion | undefined;
      const unwrapped = inner?.type === "ParenthesizedExpression" ? inner.expression : inner;
      if (
        unwrapped?.type === "TSAsExpression" &&
        unwrapped.typeAnnotation?.type === "TSUnknownKeyword"
      ) {
        doubleAssert += 1;
      }
      return;
    }
    if (node.type === "ImportExpression") {
      const spec = textOf(node["source"]);
      if (spec !== undefined) dynamicSpecs.add(spec);
      return;
    }
    if (node.type === "CallExpression") {
      const callee = node["callee"] as { type?: string; name?: string } | undefined;
      const args = node["arguments"] as readonly unknown[] | undefined;
      const spec = textOf(args?.[0]);
      if (callee?.type === "Identifier" && callee.name === "require" && spec !== undefined) {
        dynamicSpecs.add(spec);
      }
      return;
    }
    if (node.type === "Literal" || node.type === "TemplateLiteral") {
      const spec = textOf(node);
      if (spec !== undefined) literals.add(spec);
    }
  });
  return { file, static: staticSpecs, dynamic: dynamicSpecs, literals, valueEdges, doubleAssert };
}

/**
 * 文件属于哪个面。
 * @param file 文件路径。
 * @returns 面名。
 */
function faceOf(file: string): string {
  const m = /[\\/]src[\\/]([^\\/]+)/u.exec(file);
  if (m === null) return "other";
  const head = m[1];
  if (head === "ui") return "ui";
  if (head === "server") return "server";
  if (head === "endpoint" || head === "contract") return "shared";
  return "root";
}

/**
 * 递归列源码文件。
 * @param dir 目录。
 * @returns 文件列表。
 */
async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir).catch(() => [] as string[])) {
    if (entry === "node_modules") continue;
    const path = join(dir, entry);
    const info = await stat(path).catch(() => undefined);
    if (info === undefined) continue;
    if (info.isDirectory()) out.push(...(await sourceFiles(path)));
    else if (/\.(ts|tsx|mts|mjs|css)$/u.test(entry)) out.push(path);
  }
  return out;
}

const cwd = process.cwd();
const manifest = JSON.parse(await readFile(join(cwd, "package.json"), "utf8")) as {
  readonly name: string;
  readonly dependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
} & Record<string, unknown>;
// **源码含测试**：测试里用到的依赖也算"用了"（`dsh-agent-loop-testkit` 这类只在测试里出现）。
// **没有 `src/` 的包直接跳过**：那是配置/壳包（如 `dsh-oxc-node`，只有 `register.mjs`），
// 它的依赖由运行期真实使用，"声明未用"这类源码判据不适用。
const hasSrc = await stat(join(cwd, "src"))
  .then((s) => s.isDirectory())
  .catch(() => false);
if (!hasSrc) {
  console.log(JSON.stringify({ pkg: manifest.name, dir: cwd, skipped: true }));
  process.exit(0);
}
const files = await sourceFiles(join(cwd, "src"));
const imports = await Promise.all(files.map(importsOf));

// 1) 面边界（本包相对 import）
const faces: string[] = [];
for (const [index, file] of files.entries()) {
  // 面边界只判生产代码：测试装配整应用是正当的。
  if (file.includes(sep + "__tests__" + sep)) continue;
  const face = faceOf(file);
  if (face === "other" || face === "shared" || file.endsWith(".css")) continue;
  const entry = imports[index];
  if (entry === undefined) continue;
  for (const spec of [...entry.static, ...entry.dynamic]) {
    if (!spec.startsWith(".")) continue;
    const target = relative(cwd, join(dirname(file), spec));
    const tface = faceOf(join(cwd, "src", target));
    const hostImpl = /\.(service|host)\.ts$/u.test(target);
    if (face === "ui" && (tface === "server" || (tface === "root" && hostImpl)))
      faces.push(`ui→host  ${relative(cwd, file)} => ${target}`);
    else if (face === "server" && tface === "ui")
      faces.push(`server→ui  ${relative(cwd, file)} => ${target}`);
    else if (face === "root" && (tface === "server" || tface === "ui"))
      faces.push(`root→face  ${relative(cwd, file)} => ${target}`);
  }
}

// 2) 上游面（唯一化要跨包汇总）
const upstreams = new Set<string>();
for (const [index, entry] of imports.entries()) {
  // 唯一化只看**生产代码**：测试里装别的域的上游包是正当的。
  const file = files[index];
  if (file === undefined || file.includes(sep + "__tests__" + sep)) continue;
  for (const spec of [...entry.static, ...entry.dynamic, ...entry.literals]) {
    if (!spec.startsWith("@deepseek-ai/")) continue;
    const parts = spec.split("/");
    upstreams.add(parts.slice(0, 2).join("/") + "#" + (parts[2] ?? "host"));
  }
}

// 3) 声明未用：判据全在 `./rules.ts`（原 `trim-deps` 包，已收敛进来）。
//    AST 里看不到的四类依赖（自引用 / `@types` / scripts 点名 / 清单其它字段点名 / 生成物运行时）
//    由 `keepReason` 保下来；它返回 `undefined` 的才是能删的。
const dependencies = Object.keys(manifest.dependencies ?? {});
const devDependencies = Object.keys(manifest.devDependencies ?? {});
const peerDependencies = Object.keys(manifest.peerDependencies ?? {});
const declared = [...dependencies, ...devDependencies, ...peerDependencies];
const siblings = new Set(declared);
const used = new Set<string>();
for (const entry of imports) {
  for (const spec of [...entry.static, ...entry.dynamic, ...entry.literals]) {
    if (
      !spec.startsWith(".") &&
      !spec.startsWith("/") &&
      !spec.startsWith("node:") &&
      !spec.includes("://")
    ) {
      const parts = spec.split("/");
      used.add(spec.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? spec));
    }
  }
}
// 清单里**除三份依赖清单之外**的文本：这些字段用字符串点名包（`dsh.desktop` 图标、`remotes` 清单）。
// **依赖清单本身必须排除**：否则每个依赖名都在文本里"被点名"，`unused` 永远为空——判据失效。
const manifestText = JSON.stringify(
  Object.fromEntries(
    Object.entries(manifest).filter(
      ([key]) => key !== "dependencies" && key !== "devDependencies" && key !== "peerDependencies",
    ),
  ),
);
const scriptsText = JSON.stringify(manifest.scripts ?? {});
const unused = declared
  .filter(
    (dep) =>
      keepReason({
        name: dep,
        self: manifest.name,
        used,
        scripts: scriptsText,
        manifest: manifestText,
        siblings,
      }) === undefined,
  )
  .map((name) => ({
    name,
    section: dependencies.includes(name)
      ? "dependencies"
      : devDependencies.includes(name)
        ? "devDependencies"
        : "peerDependencies",
  }));

// 4) 扩展包（`agent-ex`）的边界：只许用 `contract` / `testing` / `endpoint` 三个入口，
//    且 ex 之间零依赖。这条只在 `group === "agent-ex"` 时算。
//    与面边界 / 上游唯一化同口径：**只判生产代码**（测试装整个应用是正当的）；
//    自引用（`@morlay/<自己>/server`）不算越界——那是包内测试经包名守 `exports`。
const group = dirname(cwd).split(/[\\/]/u).pop() ?? "";
const EX_ENTRIES = new Set(["contract", "testing", "endpoint"]);
const exViolations: string[] = [];
if (group === "agent-ex") {
  for (const entry of imports) {
    if (entry.file.includes(`${sep}__tests__${sep}`)) continue;
    // **浏览器半（`src/ui/**`）多一个合法入口：别的包的 `ui`**（ui 引 ui 是同一层，不是越界）。
    // 禁的是 ui → root/server：那是把宿主侧实现拖进浏览器包。
    const fromUi = entry.file.includes(`${sep}src${sep}ui${sep}`);
    for (const spec of [...entry.static, ...entry.dynamic]) {
      if (spec.startsWith(`${manifest.name}/`)) continue;
      const match =
        /^@morlay\/(dsh-[a-z-]+|agent-use|configurable-sandbox|better-session|session-mode)\/([a-z-]+)$/u.exec(
          spec,
        );
      if (match === null) continue;
      const [, , face] = match;
      if (face === undefined || EX_ENTRIES.has(face)) continue;
      if (fromUi && face === "ui") continue;
      exViolations.push(
        `入口越界：${spec}（${fromUi ? "ui 面" : "非 ui 面"}只允许 contract / testing / endpoint${fromUi ? " / ui" : ""}）`,
      );
    }
  }
  for (const dep of Object.keys(manifest.dependencies ?? {})) {
    if (!/^@morlay\/(agent-use|configurable-sandbox|better-session|session-mode)$/u.test(dep))
      continue;
    exViolations.push(`扩展之间互相依赖：${dep}`);
  }
}

// 5) 契约 / 端点面：上游包根的值边（`import type` / `export type` 不算）。判据见类型约束设计的判据 6。
//    白名单在 `./rules.ts` 的 `CONTRACT_VALUE_EDGE_ALLOWLIST`（当前为空：先出报告）。
const contractValueEdges: string[] = [];
for (const entry of imports) {
  if (!isContractOrEndpointFace(entry.file)) continue;
  for (const edge of entry.valueEdges) {
    const specifier = edge.split("  [")[0] ?? "";
    if (!isUpstreamPackageRoot(specifier)) continue;
    if (isAllowedContractValueEdge(specifier)) continue;
    contractValueEdges.push(relative(cwd, entry.file) + "  " + edge);
  }
}

// 6) 双断言 `as unknown as`：只许边界桥（白名单在 `./rules.ts`），测试不受限。判据见类型约束设计的判据 7。
const doubleAssertions: string[] = [];
for (const entry of imports) {
  if (entry.doubleAssert === 0) continue;
  if (isTestPath(entry.file) || bridgeReason(entry.file) !== undefined) continue;
  doubleAssertions.push(relative(cwd, entry.file) + "  " + String(entry.doubleAssert) + " 处");
}

console.log(
  JSON.stringify({
    pkg: manifest.name,
    exViolations,
    contractValueEdges,
    doubleAssertions,
    // `--write` 要写回的就是这个目录。
    dir: cwd,
    // 包所在组（`packages/<group>/<name>`）：框架层（zephyr）共用上游 client 包是设计，不是冲突。
    group: dirname(cwd).split(/[\\/]/u).pop() ?? "",
    faces,
    upstreams: [...upstreams],
    unused,
  }),
);
