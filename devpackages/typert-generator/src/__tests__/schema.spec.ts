import { describe, expect, it } from "vitest";
import { type Node, parseSource, walkAll } from "../ast.ts";
import { buildSchemaIndex, newContext, zodOf, type SchemaIndex } from "../schema.ts";

// ts 2 schema 的规则表：每条规则一个片段，断言产物文本。AST 走真实的 oxc 解析，不手搓节点。

function typeNodeOf(source: string): Node {
  const file = parseSource("fixture.ts", `type X = ${source};`);
  let found: Node | undefined;
  walkAll(file.program, (node) => {
    if (found === undefined && node["type"] === "TSTypeAliasDeclaration") found = node;
  });
  return (found as Node)["typeAnnotation"] as Node;
}

function zod(source: string, index: SchemaIndex = new Map()): string {
  return zodOf(typeNodeOf(source), newContext(index));
}

function emptyIndex(): SchemaIndex {
  return new Map();
}

async function indexOf(declarations: string): Promise<SchemaIndex> {
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(join(tmpdir(), "typert-schema-"));
  await writeFile(join(dir, "x.d.ts"), declarations);
  return buildSchemaIndex(dir);
}

describe("ts 2 schema", () => {
  it("关键字与字面量", () => {
    expect(zod("string")).toBe("z.string()");
    expect(zod("number")).toBe("z.number()");
    expect(zod("boolean")).toBe("z.boolean()");
    expect(zod("void")).toBe("z.void()");
    expect(zod("undefined")).toBe("z.undefined()");
    expect(zod("unknown")).toBe("z.unknown()");
    expect(zod("never")).toBe("z.never()");
    expect(zod("null")).toBe("z.literal(null)");
    expect(zod('"a"')).toBe('z.literal("a")');
    expect(zod("1")).toBe("z.literal(1)");
  });

  it("数组与 union（null 排最前，其余照源码顺序）", () => {
    expect(zod("string[]")).toBe("z.array(z.string())");
    expect(zod("string | null")).toBe("z.union([z.literal(null), z.string()])");
    expect(zod('"a" | "b" | null')).toBe(
      'z.union([z.literal(null), z.literal("a"), z.literal("b")])',
    );
  });

  it("对象字面量：字段、optional、readonly", () => {
    expect(zod("{ a: string; b?: number; readonly c: boolean }")).toBe(
      "z.object({\n" +
        "  'a': z.string(),\n" +
        "  'b': z.number().optional(),\n" +
        "  'c': z.boolean().readonly(),\n" +
        "})",
    );
  });

  it("索引签名走 z.record", () => {
    expect(zod("{ [key: string]: number }")).toBe("z.record(z.string(), z.number())");
  });

  it("内置泛型：Array / Record / Promise / ReadonlyArray", () => {
    expect(zod("Array<string>")).toBe("z.array(z.string())");
    expect(zod("ReadonlyArray<string>")).toBe("z.array(z.string()).readonly()");
    expect(zod("Record<string, number>")).toBe("z.record(z.string(), z.number())");
    expect(zod("Promise<string>")).toBe("z.string()");
  });

  it("自定义类型就地展开（interface / type / enum）", async () => {
    const index = await indexOf(
      [
        "export interface Point { readonly x: number; y: number }",
        "export type Id = string | number;",
        'export enum Kind { A = "a", B = "b" }',
      ].join("\n"),
    );
    expect(zod("Point", index)).toBe(
      "z.object({\n  'x': z.number().readonly(),\n  'y': z.number(),\n})",
    );
    expect(zod("Id", index)).toBe("z.union([z.string(), z.number()])");
    expect(zod("Kind", index)).toBe('z.union([z.literal("a"), z.literal("b")])');
  });

  it("递归类型走 z.lazy 自引用", async () => {
    const index = await indexOf("export interface Node { next: Node | null; value: string }");
    expect(zod("Node", index)).toBe(
      "z.object({\n  'next': z.union([z.literal(null), z.lazy(() => NodeRemoteCodec$schema())]),\n  'value': z.string(),\n})",
    );
  });

  it("brand 标记折叠、嵌套 union 展平、类型操作符忽略", () => {
    expect(zod("string & { readonly BRAND: unique symbol }")).toBe(
      "z.intersection(z.string(), z.unknown())",
    );
    expect(zod('("a" | "b") | ("c" | "d")')).toBe(
      'z.union([z.literal("a"), z.literal("b"), z.literal("c"), z.literal("d")])',
    );
    expect(zod("readonly string[]")).toBe("z.array(z.string())");
  });

  it("AsyncIterable 解包（stream 方法的 wire 类型）", () => {
    expect(zod("AsyncIterable<boolean>")).toBe("z.boolean()");
  });

  it("解析不了就报错（与上游同规则：不静默降级成 unknown）", async () => {
    expect(() => zod("Missing")).toThrow(/引用解析失败：Missing/);
    expect(await indexOf("")).toEqual(emptyIndex());
  });
});
