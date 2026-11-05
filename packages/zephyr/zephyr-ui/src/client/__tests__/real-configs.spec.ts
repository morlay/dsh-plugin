// 判别式配置在页面上排成什么行：schema 投影 → 行视图的验收。
//
// `type` 是判别式 union 的标签，切到另一支就换一整套字段。样例配置在
// `../../schema-form/testing/discriminated-config.ts`（原 `session-rdb` 那份的形状）。

import z from "@deepseek-ai/schemastery";
import { describe, expect, it } from "vitest";
import { discriminatedConfig } from "../schema-form/testing/discriminated-config.ts";
import { addableAt, fieldKey } from "../schema-form/controller.ts";
import type { SchemaFormState } from "../schema-form/controller.ts";
import { editorLines, type EditorLine } from "../schema-form/lines.ts";
import { zh } from "../schema-form/locales.ts";
import { projectNode, readPath, walkFields, type FieldNode } from "../schema-form/schema-node.ts";
import type { SchemaFormTranslate } from "../schema-form/slot-contract.ts";

const t = ((key: string) =>
  (zh as unknown as Record<string, string>)[key] ?? key) as unknown as SchemaFormTranslate;
const resolveText = (text: string | Readonly<Record<string, string>>): string =>
  typeof text === "string" ? text : (text["zh"] ?? "");

// 一段配置排出的行：值按路径喂给字段行，与页面读数同一形状。
function linesOf(schema: unknown, value: unknown): EditorLine[] {
  const root: FieldNode = projectNode(new z(schema as never));
  const walked = walkFields(root, value);
  // 可添加项用控制器同一算法：值里没有的声明字段成为这一层的候选。
  const addable = new Map(
    walked.flatMap((item) => {
      const options = addableAt(item.node, item.path, readPath(value, item.path), undefined);
      return options.length === 0 ? [] : [[fieldKey(item.path), options] as const];
    }),
  );
  const state = {
    walked,
    fields: new Map(
      walked.map((item) => [
        fieldKey(item.path),
        {
          value: readPath(value, item.path),
          text: undefined,
          invalid: undefined,
          overridden: false,
        },
      ]),
    ),
    texts: new Map(),
    secrets: new Map(),
    options: new Map(),
    addable,
    invalidAt: new Map(),
  } as unknown as SchemaFormState;
  return editorLines(state, { collapsed: () => false, toggle: () => {} }, resolveText, t);
}

// 某条路径上的那一行。
function lineAt(lines: readonly EditorLine[], path: string): EditorLine | undefined {
  return lines.find(
    (line) => line.kind !== "comment" && line.kind !== "close" && line.path.join(".") === path,
  );
}

// 字段行的路径（按页面顺序）。
function fieldPaths(lines: readonly EditorLine[]): string[] {
  return lines.filter((line) => line.kind === "field").map((line) => line.path.join("."));
}

describe("判别式配置排出的行", () => {
  it("判别式配置的 type 是标签：那一行带切换，切到另一支就换一整套字段", () => {
    const sqlite = linesOf(discriminatedConfig, { type: "sqlite", path: "/tmp/a.db" });
    const tag = lineAt(sqlite, "type");

    expect(tag?.kind).toBe("field");
    expect(tag?.kind === "field" ? tag.variants?.choices : undefined).toEqual([
      { label: '"sqlite"', value: "sqlite" },
      { label: '"postgres"', value: "postgres" },
    ]);
    expect(fieldPaths(sqlite)).toContain("path");

    const postgres = linesOf(discriminatedConfig, {
      type: "postgres",
      connectionString: "postgres://x",
    });
    expect(fieldPaths(postgres)).toContain("connectionString");
    expect(fieldPaths(postgres)).not.toContain("path");
  });
});
