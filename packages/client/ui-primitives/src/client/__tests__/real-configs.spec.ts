// 真包的配置在页面上排成什么行：跨包契约的验收（schema 投影 → 行视图）。
//
// 本文件只留 `session-rdb` 的：`type` 是判别式 union 的标签，切到另一支就换一整套字段。
// sandbox-local 那半（`access` 的 union 形状、装配事实只读可见）搬到了那份配置自己的包（`@morlay/dsh-sandbox-local` 的 client 面）。

import z from "@deepseek-ai/schemastery";
import { describe, expect, it } from "vitest";
import { SessionPersistenceRdb } from "@morlay/session-rdb";
import { addableAt, fieldKey } from "../schema-form/controller.ts";
import type { SchemaFormState } from "../schema-form/controller.ts";
import { editorLines, type EditorLine } from "../schema-form/lines.ts";
import { zh } from "../schema-form/locales.ts";
import {
  projectNode,
  readPath,
  walkFields,
  type FieldNode,
} from "../schema-form/schema-node.ts";
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


describe("真配置排出的行", () => {
  it("session-rdb 的 type 是判别标签：那一行带切换，切到另一支就换一整套字段", () => {
    const sqlite = linesOf(SessionPersistenceRdb.Config, { type: "sqlite", path: "/tmp/a.db" });
    const tag = lineAt(sqlite, "type");

    expect(tag?.kind).toBe("field");
    expect(tag?.kind === "field" ? tag.variants?.choices : undefined).toEqual([
      { label: '"sqlite"', value: "sqlite" },
      { label: '"postgres"', value: "postgres" },
    ]);
    expect(fieldPaths(sqlite)).toContain("path");

    const postgres = linesOf(SessionPersistenceRdb.Config, {
      type: "postgres",
      connectionString: "postgres://x",
    });
    expect(fieldPaths(postgres)).toContain("connectionString");
    expect(fieldPaths(postgres)).not.toContain("path");
  });
});
