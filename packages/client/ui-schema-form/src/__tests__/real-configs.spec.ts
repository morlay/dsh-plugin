/**
 * 真包的配置在页面上排成什么行：跨包契约的验收（schema 投影 → 行视图）。
 *
 * 这些形状是用户在页面上第一眼看到的东西，所以拿真包的真 schema 断言：`access` 是「一段文本或一组文本」的 union、
 * `session-rdb` 的 `type` 是判别式 union 的标签、装配事实只读可见。
 */

import z from "@deepseek-ai/schemastery";
import { describe, expect, it } from "vitest";
import { Config as SandboxConfig } from "../../../../sandbox/dsh-sandbox-local/src/config.ts";
import { SessionPersistenceRdb } from "../../../../session/session-rdb/src/index.ts";
import { addableAt, fieldKey } from "../client/controller.ts";
import type { SchemaFormState } from "../client/controller.ts";
import { editorLines, type EditorLine } from "../client/lines.ts";
import { zh } from "../client/locales.ts";
import { projectNode, readPath, walkFields, type FieldNode } from "../client/schema-node.ts";
import type { SchemaFormTranslate } from "../client/slot-contract.ts";

const t = ((key: string) =>
  (zh as unknown as Record<string, string>)[key] ?? key) as unknown as SchemaFormTranslate;
const resolveText = (text: string | Readonly<Record<string, string>>): string =>
  typeof text === "string" ? text : (text["zh"] ?? "");

/** 一段配置排出的行：值按路径喂给字段行，与页面读数同一形状。 */
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

/** 某一层的闭合行上的可添加项。 */
function addableAtLine(lines: readonly EditorLine[], path: string) {
  const close = lines.find((line) => line.kind === "close" && line.path.join(".") === path);
  if (close?.kind !== "close") throw new Error(`no close line at ${path}`);
  return close.add;
}

/** 某条路径上的那一行。 */
function lineAt(lines: readonly EditorLine[], path: string): EditorLine | undefined {
  return lines.find(
    (line) => line.kind !== "comment" && line.kind !== "close" && line.path.join(".") === path,
  );
}

/** 字段行的路径（按页面顺序）。 */
function fieldPaths(lines: readonly EditorLine[]): string[] {
  return lines.filter((line) => line.kind === "field").map((line) => line.path.join("."));
}

/** 顶层字段在页面上出现的顺序（容器行与值行都算）。 */
function topPaths(lines: readonly EditorLine[]): string[] {
  return lines
    .filter((line) => (line.kind === "open" || line.kind === "field") && line.path.length === 1)
    .map((line) => line.path.join("."));
}

describe("真配置排出的行", () => {
  it("sandbox-local 的 access 是一组路径时画成数组，并能在「一组」与「一段」之间切", () => {
    const lines = linesOf(SandboxConfig, { access: ["rw:/tmp"] });
    const access = lineAt(lines, "access");

    expect(access?.kind).toBe("open");
    expect(access?.kind === "open" ? access.shape : undefined).toBe("array");
    expect(access?.kind === "open" ? access.variants?.choices : undefined).toEqual([
      { label: "[ ]", value: [] },
      { label: '""', value: null },
    ]);
    expect(fieldPaths(lines)).toContain("access.0");
  });

  it("sandbox-local 的 access 是一段文本时画成值行（不再是空对象）", () => {
    const lines = linesOf(SandboxConfig, { access: "rw:/tmp" });
    const access = lineAt(lines, "access");

    expect(access?.kind).toBe("field");
    expect(access?.kind === "field" ? access.variants?.selected : undefined).toBe(1);
    expect(access?.kind === "field" ? access.field.value : undefined).toBe("rw:/tmp");
  });

  it("只出现值里有的字段：没配的声明字段不占行，而是成为这一层的添加候选", () => {
    const lines = linesOf(SandboxConfig, { access: [], cwd: "/tmp" });

    expect(topPaths(lines)).toEqual(["access", "cwd"]);
    const add = addableAtLine(lines, "");
    expect(add?.kind).toBe("prop");
    expect(add?.kind === "prop" ? add.options.map((option) => option.key) : []).toEqual([
      "runnerCommand",
      "runnerFailureSignatures",
      "probeTimeoutMs",
      "diffBasisMaxBytes",
    ]);
    // 候选带说明（选之前就知道加的是什么）。
    expect(add?.kind === "prop" ? add.options[0]?.description : undefined).toBeDefined();
  });

  it("sandbox-local 的装配事实只读可见（值照画、注释标只读）", () => {
    const lines = linesOf(SandboxConfig, { access: [], cwd: "/tmp" });
    const cwd = lineAt(lines, "cwd");
    const comment = lines.find((line) => line.kind === "comment" && line.path.join(".") === "cwd");

    expect(cwd?.kind === "field" ? cwd.node.meta.disabled : undefined).toBe(true);
    expect(comment?.kind === "comment" ? comment.text : "").toContain("只读");
  });

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
