import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { entryListSchema } from "@deepseek-ai/cordis-plugin-include";
import { scopeRow } from "@morlay/dsh-context-assembler/rows";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { configProblem, type SessionMode } from "../modes.ts";
import { DEFAULT_MODE, MODE_SOURCES } from "../../tool/modes.ts";
import { PATCH_ROWS, renderPatch } from "../../tool/patch.ts";

const PATCH_PATH = join(process.cwd(), "packages/profile/dsh-session-mode/cordis.patch.yml");

interface Row {
  readonly id?: string;
  readonly name?: string;
  readonly config?: unknown;
  readonly insert?: readonly Row[];
}

const rows = yaml.load(await readFile(PATCH_PATH, "utf8"), { schema: entryListSchema }) as Row[];

/** 本包的行清单：patch 里那一段 `insert`。 */
const inserted = rows.flatMap((row) => row.insert ?? []);

describe("session-mode patch wiring", () => {
  it("仓库里那份与生成结果同形", async () => {
    const stored = yaml.load(await readFile(PATCH_PATH, "utf8"), {
      schema: entryListSchema,
    }) as Row[];
    const generated = yaml.load(renderPatch(), { schema: entryListSchema }) as Row[];

    expect(stored).toEqual(generated);
    expect(
      renderPatch().startsWith("# 本文件由 packages/profile/dsh-session-mode/tool/patch.ts 生成"),
    ).toBe(true);
  });

  it("两行：模式本身，与模式的工具收口（行 id 与 name 归 context-assembler 的 `scopeRow()`）", () => {
    expect(inserted.map((row) => row.id)).toEqual(["session-mode", "context-assembler-scope"]);
    expect(inserted[0]?.name).toBe("@morlay/dsh-session-mode");
    // 单一行源的证据：这一行不是手写的 YAML，而是那个出口给的行。
    expect(inserted[1]).toMatchObject(scopeRow());
  });

  it("模式清单逐项等于 `tool/modes.ts` 的源数据", () => {
    const config = inserted[0]?.config as {
      default?: string;
      modes?: Record<string, SessionMode>;
    };

    expect(config.default).toBe(DEFAULT_MODE);
    expect(Object.keys(config.modes ?? {})).toEqual(MODE_SOURCES.map((source) => source.id));
    for (const source of MODE_SOURCES) {
      const mode = config.modes?.[source.id];
      expect(mode?.name).toBe(source.name);
      expect(mode?.description).toBe(source.description);
      expect(mode?.persona).toEqual(source.persona);
      expect(mode?.role ?? ["main"]).toEqual(source.role ?? ["main"]);
      expect(mode?.defaultModel).toEqual(source.defaultModel);
      expect(mode?.allowTools).toEqual(source.allowTools);
      expect(mode?.instructions ?? true).toBe(source.instructions ?? true);
      expect(mode?.runtimeContext ?? true).toBe(source.runtimeContext ?? true);
    }
  });

  it("chat 只要三件工具并关掉两类注入；coding 拿整套工具集", () => {
    const config = inserted[0]?.config as { modes?: Record<string, SessionMode> };

    expect(config.modes?.["chat"]?.allowTools).toEqual([
      "ask_user_question",
      "web_search",
      "web_fetch",
    ]);
    expect(config.modes?.["chat"]?.instructions).toBe(false);
    expect(config.modes?.["chat"]?.runtimeContext).toBe(false);
    // 配对判据：少了它，"全都不给动态快照"也能让上面通过。
    expect(config.modes?.["coding"]?.runtimeContext ?? true).toBe(true);
    expect(config.modes?.["coding"]?.instructions ?? true).toBe(true);
    expect(config.modes?.["coding"]?.allowTools?.length).toBeGreaterThan(20);
  });

  it("装配期校验：默认模式必须在清单里，每个模式都要有工具白名单", () => {
    const modes = { coding: { name: "编码", allowTools: ["read"] } };

    expect(configProblem({ default: "coding", modes })).toBeUndefined();
    expect(configProblem({ default: "chat", modes })).toContain("default");
    expect(configProblem({ default: "coding", modes: {} })).toContain("at least one mode");
    expect(configProblem({ default: "coding", modes: { coding: { allowTools: [] } } })).toContain(
      "allowTools",
    );
  });

  it("patch 里没有遗留的 preset 行或 relax-intent：模式不再是 Cordis 子树", () => {
    const names = JSON.stringify(PATCH_ROWS);

    expect(names).not.toContain("@deepseek-ai/dsh-agent-preset");
    expect(names).not.toContain("relax-intent");
    expect(names).not.toContain("fs-intent-relax");
  });
});
