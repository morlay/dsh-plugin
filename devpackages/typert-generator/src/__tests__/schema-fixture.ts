// 上游 `packages/typert/generator/tests/schema-emitter.spec.ts` 的契约是"**类型 → 接受哪些值 / 拒绝哪些值**"，
// 它的输入用自家内部模型（`TypeNodeModel`）。这条线用 AST，所以给同一批契约一个同形入口：**一段声明文本
// → 我们生成的 zod**，并且真的在 zod 上 parse（不是比对表达式字符串）。
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { buildSchemaIndex, membersOf, newContext, objectOf, zodOf } from "../schema.ts";

export interface Fixture {
  /** 生成的 zod 表达式文本（失败时便于看现场）。 */
  readonly expression: string;
  /** 这个 schema 是否接受该值。 */
  readonly accepts: (value: unknown) => boolean;
}

/**
 * 一段声明文本（`.d.ts` 内容）→ 其中 `Fixture` 这个类型的 zod 校验器。
 *
 * @param source - 声明文本；必须导出 `Fixture`。
 * @returns 表达式与校验函数。
 */
export async function fixtureOfSource(source: string): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "typert-schema-fixture-"));
  try {
    await writeFile(join(root, "fixture.d.ts"), source);
    const index = await buildSchemaIndex(root);
    const declared = index.get("Fixture");
    if (declared === undefined)
      throw new Error("fixture 没进索引：检查 source 里是否 `export` 了 Fixture");
    const context = newContext(index, { file: declared.file });
    // interface 必须走 `membersOf`（它会摊平 `extends` 的基接口字段）——直接取 `body.body` 只拿到自身字段，
    // 那样测出来的"继承"是假的。
    const expression =
      declared.node["type"] === "TSTypeAliasDeclaration"
        ? zodOf(declared.node["typeAnnotation"], context)
        : objectOf(membersOf(declared, context), context);
    // oxlint-disable-next-line typescript/no-implied-eval -- 测试辅助：把生成的 zod 表达式文本变成真 schema，
    // 才好按上游的契约断言"接受 / 拒绝哪些值"。
    const schema = new Function("z", `return (${expression});`)(z) as {
      safeParse: (value: unknown) => { success: boolean };
    };
    return { expression, accepts: (value) => schema.safeParse(value).success };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/**
 * 一个类型表达式 → `${typeText}` 形式的 Fixture。
 *
 * @param typeText - 类型表达式文本（如 `string`、`{ a: string }`）。
 * @returns 表达式与校验函数。
 */
export async function fixtureOf(typeText: string): Promise<Fixture> {
  return await fixtureOfSource(`export type Fixture = ${typeText};\n`);
}
