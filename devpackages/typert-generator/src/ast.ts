import { readFile } from "node:fs/promises";
import { parseSync } from "oxc-parser";

// 这一层只做"源码 / 声明 → AST"的机械活：解析、遍历、取 JSDoc。所有领域判断都在别处。

/** oxc 的 AST 节点（ESTree 形态）：字段按需取，不做完整建模。 */
export type Node = Record<string, any>;

export type ParsedFile = {
  path: string;
  source: string;
  program: Node;
  comments: Node[];
};

export async function parseFile(path: string): Promise<ParsedFile> {
  const source = await readFile(path, "utf8");
  // oxlint-disable-next-line node/no-sync -- oxc-parser 只有同步入口（纯 CPU 解析，不碰 IO）
  const result = parseSync(path, source, { sourceType: "module" });
  const first = result.errors[0];
  if (first !== undefined) {
    throw new Error(`${path}: 解析失败 ${String(first.message ?? first)}`);
  }
  return {
    path,
    source,
    program: result.program as Node,
    comments: (result.comments ?? []) as Node[],
  };
}

/** 从内存源码解析（片段分析 / 测试用）。 */
export function parseSource(path: string, source: string): ParsedFile {
  // oxlint-disable-next-line node/no-sync -- oxc-parser 只有同步入口（纯 CPU 解析，不碰 IO）
  const result = parseSync(path, source, { sourceType: "module" });
  const first = result.errors[0];
  if (first !== undefined) throw new Error(`${path}: 解析失败 ${String(first.message ?? first)}`);
  return {
    path,
    source,
    program: result.program as Node,
    comments: (result.comments ?? []) as Node[],
  };
}

export function walkAll(node: unknown, visit: (node: Node) => void): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walkAll(item, visit);
    return;
  }
  const record = node as Node;
  if (typeof record["type"] === "string") visit(record);
  for (const value of Object.values(record)) walkAll(value, visit);
}

/** 紧贴在节点上方（中间只有空白、最多隔一行空行）的块注释就是它的 JSDoc。 */
export function jsDocOf(file: ParsedFile, node: Node): string | undefined {
  const start = node["start"];
  if (typeof start !== "number") return undefined;
  let best: Node | undefined;
  for (const comment of file.comments) {
    if (comment["type"] !== "Block") continue;
    const end = comment["end"];
    if (typeof end !== "number" || end > start) continue;
    if (!String(comment["value"] ?? "").startsWith("*")) continue;
    const between = file.source.slice(end, start);
    if (between.trim() !== "") continue;
    if ((between.match(/\n/gu) ?? []).length > 2) continue;
    if (best === undefined || end > (best["end"] as number)) best = comment;
  }
  return best === undefined ? undefined : String(best["value"] ?? "");
}

/** 类型类声明：同名函数 / 常量（`export function SessionId`）不是类型，索引与出口表都只认这几种。 */
export function isTypeDeclaration(node: Node): boolean {
  return (
    node["type"] === "TSInterfaceDeclaration" ||
    node["type"] === "TSTypeAliasDeclaration" ||
    node["type"] === "TSEnumDeclaration" ||
    node["type"] === "ClassDeclaration"
  );
}

/** 取注解的"名字"文本（`Identifier` / `TSQualifiedName`）。 */
export function nameOf(node: Node | null | undefined): string | undefined {
  if (node === null || node === undefined) return undefined;
  if (node["type"] === "Identifier") return node["name"] as string;
  if (node["type"] === "TSQualifiedName") {
    const left = nameOf(node["left"] as Node);
    const right = nameOf(node["right"] as Node);
    return left === undefined || right === undefined ? undefined : `${left}.${right}`;
  }
  return undefined;
}

/** 类型实参（oxc 用 ESTree 的 `typeArguments`）。 */
export function typeArgumentsOf(node: Node): Node[] {
  const args = node["typeArguments"];
  return Array.isArray(args?.["params"]) ? (args["params"] as Node[]) : [];
}

/** 位置：产物里的 `sourceLocation` 用的是 1 基行 / 列。 */
export function locationOf(
  file: ParsedFile,
  node: Node,
): { file: string; line: number; column: number } {
  const start = typeof node["start"] === "number" ? (node["start"] as number) : 0;
  const before = file.source.slice(0, start);
  const lines = before.split("\n");
  return {
    file: file.path,
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  };
}
