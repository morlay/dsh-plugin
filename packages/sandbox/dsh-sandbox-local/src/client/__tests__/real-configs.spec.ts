// 本包 `Config` 的真配置在页面上排成什么行：schema 投影 → 行视图的验收（表单那侧在
// `@morlay/dsh-client-ui-primitives`，这里只验本包配置排出的形状）。
//
// 这些形状是用户在页面上第一眼看到的东西，所以拿真 schema 断言：`access` 是「一段文本或一组文本」的 union、
// 装配事实只读可见、没配的声明字段成为这一层的添加候选。

import z from "@deepseek-ai/schemastery";
import { describe, expect, it } from "vitest";
import { schemaForm } from "@morlay/dsh-client-ui-primitives/client";
import { Config as SandboxConfig } from "@morlay/dsh-sandbox-local";

const t = ((key: string) =>
  (schemaForm.zh as unknown as Record<string, string>)[key] ??
  key) as unknown as schemaForm.SchemaFormTranslate;
const resolveText = (text: string | Readonly<Record<string, string>>): string =>
  typeof text === "string" ? text : (text["zh"] ?? "");

// 一段配置排出的行：值按路径喂给字段行，与页面读数同一形状。
function linesOf(schema: unknown, value: unknown): schemaForm.EditorLine[] {
  const root: schemaForm.FieldNode = schemaForm.projectNode(new z(schema as never));
  const walked = schemaForm.walkFields(root, value);
  // 可添加项用控制器同一算法：值里没有的声明字段成为这一层的候选。
  const addable = new Map(
    walked.flatMap((item) => {
      const options = schemaForm.addableAt(
        item.node,
        item.path,
        schemaForm.readPath(value, item.path),
        undefined,
      );
      return options.length === 0 ? [] : [[schemaForm.fieldKey(item.path), options] as const];
    }),
  );
  const state = {
    walked,
    fields: new Map(
      walked.map((item) => [
        schemaForm.fieldKey(item.path),
        {
          value: schemaForm.readPath(value, item.path),
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
  } as unknown as schemaForm.SchemaFormState;
  return schemaForm.editorLines(state, { collapsed: () => false, toggle: () => {} }, resolveText, t);
}

// 某一层的闭合行上的可添加项。
function addableAtLine(lines: readonly schemaForm.EditorLine[], path: string) {
  const close = lines.find((line) => line.kind === "close" && line.path.join(".") === path);
  if (close?.kind !== "close") throw new Error(`no close line at ${path}`);
  return close.add;
}

// 某条路径上的那一行。
function lineAt(
  lines: readonly schemaForm.EditorLine[],
  path: string,
): schemaForm.EditorLine | undefined {
  return lines.find(
    (line) => line.kind !== "comment" && line.kind !== "close" && line.path.join(".") === path,
  );
}

// 字段行的路径（按页面顺序）。
function fieldPaths(lines: readonly schemaForm.EditorLine[]): string[] {
  return lines.filter((line) => line.kind === "field").map((line) => line.path.join("."));
}

// 顶层字段在页面上出现的顺序（容器行与值行都算）。
function topPaths(lines: readonly schemaForm.EditorLine[]): string[] {
  return lines
    .filter((line) => (line.kind === "open" || line.kind === "field") && line.path.length === 1)
    .map((line) => line.path.join("."));
}

describe("真配置排出的行", () => {
  it("access 是一组路径时画成数组，并能在「一组」与「一段」之间切", () => {
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

  it("access 是一段文本时画成值行（不再是空对象）", () => {
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

  it("装配事实只读可见（值照画、注释标只读）", () => {
    const lines = linesOf(SandboxConfig, { access: [], cwd: "/tmp" });
    const cwd = lineAt(lines, "cwd");
    const comment = lines.find((line) => line.kind === "comment" && line.path.join(".") === "cwd");

    expect(cwd?.kind === "field" ? cwd.node.meta.disabled : undefined).toBe(true);
    expect(comment?.kind === "comment" ? comment.text : "").toContain("只读");
  });
});
