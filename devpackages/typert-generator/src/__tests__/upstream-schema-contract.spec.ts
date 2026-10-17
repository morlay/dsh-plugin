// **上游 `packages/typert/generator/tests/schema-emitter.spec.ts` 的契约**（整批搬运）：它的 supported /
// unsupported 两组说的都是"这个类型接受哪些值、拒绝哪些值"。输入换成等价**类型文本**（上游用自家内部
// `TypeNodeModel`），断言照旧在 zod 上真跑 parse。
//
// 为什么值得整批搬：这条线是自己按 AST 重写的一版（上游那份要类型检查器），**同一批类型语法必须给出同一套
// 接受面**。丢过的那条就是实例——`interface X extends Y` 的继承成员没摊平，wire 参数被静默丢掉（详见
// `schema.ts` 的 `membersOf`）。
import { describe, expect, it } from "vitest";
import { fixtureOf, fixtureOfSource } from "./schema-fixture.ts";

interface Case {
  readonly name: string;
  /** 类型表达式文本（`Fixture = …` 的右半）；给了 `source` 时忽略。 */
  readonly type?: string;
  /** 完整声明文本（自引用 / 继承这类需要多个声明的用例）。 */
  readonly source?: string;
  readonly accepted: readonly unknown[];
  readonly rejected: readonly unknown[];
}

const SUPPORTED: readonly Case[] = [
  { name: "any", type: "any", accepted: [undefined], rejected: [] },
  { name: "unknown", type: "unknown", accepted: [{ arbitrary: true }], rejected: [] },
  { name: "never", type: "never", accepted: [], rejected: [undefined] },
  { name: "string", type: "string", accepted: ["value"], rejected: [1] },
  { name: "number", type: "number", accepted: [1], rejected: ["1"] },
  { name: "boolean", type: "boolean", accepted: [true], rejected: ["true"] },
  { name: "undefined", type: "undefined", accepted: [undefined], rejected: [null] },
  { name: "void", type: "void", accepted: [undefined], rejected: [null] },
  { name: "literal", type: "'ready'", accepted: ["ready"], rejected: ["waiting"] },
  { name: "numeric literal", type: "-2", accepted: [-2], rejected: [2] },
  { name: "bigint literal", type: "-2n", accepted: [-2n], rejected: [-2] },
  { name: "boolean literal", type: "false", accepted: [false], rejected: [true] },
  { name: "null literal", type: "null", accepted: [null], rejected: [undefined] },
  {
    name: "no-substitution template literal",
    type: "`fixed`",
    accepted: ["fixed"],
    rejected: ["other"],
  },
  { name: "parenthesized", type: "(string)", accepted: ["value"], rejected: [1] },
  { name: "standard reference", type: "Date", accepted: [new Date(0)], rejected: ["1970-01-01"] },
  {
    name: "standard Array reference",
    type: "Array<string>",
    accepted: [["value"]],
    rejected: [[1]],
  },
  {
    name: "standard ReadonlyArray reference",
    type: "ReadonlyArray<number>",
    accepted: [[1]],
    rejected: [["1"]],
  },
  {
    name: "standard Record reference",
    type: "Record<string, number>",
    accepted: [{ one: 1 }],
    rejected: [{ one: "1" }],
  },
  { name: "array", type: "string[]", accepted: [["value"]], rejected: [[1]] },
  { name: "readonly array", type: "readonly string[]", accepted: [["value"]], rejected: [[1]] },
  { name: "union", type: "string | number", accepted: ["value", 1], rejected: [true] },
  { name: "single union", type: "string", accepted: ["value"], rejected: [1] },
  {
    name: "intersection",
    type: "{ name: string } & { count: number }",
    accepted: [{ name: "value", count: 1 }],
    rejected: [{ name: "value" }],
  },
  {
    name: "object property",
    type: "{ name: string }",
    accepted: [{ name: "value" }],
    rejected: [{ name: 1 }],
  },
  {
    name: "optional property",
    type: "{ name?: string }",
    accepted: [{}, { name: "value" }],
    rejected: [{ name: 1 }],
  },
  {
    name: "readonly property",
    type: "{ readonly name: string }",
    accepted: [{ name: "value" }],
    rejected: [{ name: 1 }],
  },
  {
    name: "index signature",
    type: "{ [key: string]: number }",
    accepted: [{ one: 1 }],
    rejected: [{ one: "1" }],
  },
  {
    name: "nested object",
    type: "{ inner: { deep: string } }",
    accepted: [{ inner: { deep: "v" } }],
    rejected: [{ inner: {} }],
  },
  {
    name: "Partial",
    type: "Partial<{ name: string }>",
    accepted: [{}, { name: "value" }],
    rejected: [{ name: 1 }],
  },
  {
    name: "Readonly",
    type: "Readonly<{ name: string }>",
    accepted: [{ name: "value" }],
    rejected: [{ name: 1 }],
  },
  // 这条是丢参数的现场：`provider` / `model` 都是从基接口继承来的。
  {
    name: "inherited members",
    source: [
      "export interface Selection { provider: string; model: string }",
      "export interface Fixture extends Selection { sessionId: string }",
      "",
    ].join("\n"),
    accepted: [{ provider: "deepseek-official", model: "deepseek-flash", sessionId: "s" }],
    rejected: [{ model: "deepseek-flash", sessionId: "s" }],
  },
  {
    name: "inherited members through two levels",
    source: [
      "export interface Base { provider: string }",
      "export interface Middle extends Base { model: string }",
      "export interface Fixture extends Middle { sessionId: string }",
      "",
    ].join("\n"),
    accepted: [{ provider: "p", model: "m", sessionId: "s" }],
    rejected: [{ model: "m", sessionId: "s" }],
  },
  {
    name: "own member overrides the inherited one",
    source: [
      "export interface Base { name: string }",
      "export interface Fixture extends Base { name: number }",
      "",
    ].join("\n"),
    accepted: [{ name: 1 }],
    rejected: [{ name: "value" }],
  },
];

// 上游 strict 表之外的形态：这条线**有意兜底成 `z.unknown()`**（宽松、不拒合法值），而不是让整条生成失败。
// 这是取舍不是回归——`bigint` / `symbol` / `object` / `tuple` 在 wire 面上都未出现，真要用时再补语义。
const FALLBACKS: readonly { readonly name: string; readonly type: string }[] = [
  { name: "bigint", type: "bigint" },
  { name: "symbol", type: "symbol" },
  { name: "object", type: "object" },
  { name: "tuple", type: "[string, number]" },
];

describe("schema emitter 的上游契约（schema-emitter.spec.ts）", () => {
  for (const item of SUPPORTED) {
    it(item.name, async () => {
      const fixture =
        item.source === undefined
          ? await fixtureOf(item.type ?? "")
          : await fixtureOfSource(item.source);
      const where = `${item.name} :: ${fixture.expression.replace(/\s+/gu, " ")}`;
      for (const value of item.accepted)
        expect(fixture.accepts(value), `应接受 ${String(value)} @ ${where}`).toBe(true);
      for (const value of item.rejected)
        expect(fixture.accepts(value), `应拒绝 ${String(value)} @ ${where}`).toBe(false);
    });
  }

  for (const item of FALLBACKS) {
    it(`${item.name}（有意兜底）`, async () => {
      const fixture = await fixtureOf(item.type);
      expect(fixture.expression.startsWith("z.unknown()")).toBe(true);
      expect(fixture.accepts({ anything: true })).toBe(true);
    });
  }
});
