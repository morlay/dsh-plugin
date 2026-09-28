import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { applyEntryPatches, entryListSchema } from "@deepseek-ai/cordis-plugin-include";
import { TOOLKIT_PRESET_ROWS } from "@morlay/dsh-agent-toolkit/rows";
import { MODE_PRESET_ID, sessionModeRows } from "@morlay/dsh-session-mode/rows";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { render } from "../../tsdown.config.ts";

interface Row {
  id?: string;
  name?: string;
  group?: boolean;
  insert?: Row[];
  config?: Record<string, unknown>;
}

/** 本 bundle 的 patch（生成物 = 真源渲染结果）。 */
function patch(): Row[] {
  return yaml.load(render(), { schema: entryListSchema }) as Row[];
}

/** 顶层 `insert` 里的所有行（生成物只由 insert 段构成）。 */
function inserted(): Row[] {
  return patch().flatMap((layer) => layer.insert ?? []);
}

function rowById(rows: readonly Row[], id: string): Row {
  const found = rows.find((row) => row.id === id);
  if (found === undefined) throw new Error(`patch 里没有 ${id} 这一行`);
  return found;
}

const compose = applyEntryPatches as unknown as (
  data: unknown[],
  patches: unknown[],
  warn: (...args: unknown[]) => void,
) => Row[];

/** 本 bundle 的 patch + better-session 的 patch（两者都插了共享 client 行）。 */
async function layers(): Promise<Row[]> {
  const mine = patch();
  const theirs = yaml.load(
    await readFile(join(process.cwd(), "bundles/better-session/cordis.patch.yml"), "utf8"),
    { schema: entryListSchema },
  ) as Row[];
  return compose([], [...mine, ...theirs], () => {});
}

describe("session-mode-profile 的 bundle patch", () => {
  it("仓库里那份与生成结果同形", async () => {
    const stored = await readFile(
      join(process.cwd(), "bundles/session-mode-profile/cordis.patch.yml"),
      "utf8",
    );

    expect(stored).toBe(render());
    expect(
      render().startsWith("# 本文件由 bundles/session-mode-profile/tsdown.config.ts 生成"),
    ).toBe(true);
  });

  it("共享 client 行与别的 bundle 重复插入：两份内容一致（Loader 同 id 复用 Entry，后者胜）", async () => {
    const rows = await layers();

    // `ui-schema-form` 已在 2026-09-28 并进 ui-primitives：共享面只剩这一行。
    for (const [id, name] of [
      ["ui-primitives-fork", "@morlay/dsh-client-ui-primitives"],
    ] as const) {
      const inserted = rows.filter((row) => row.id === id).map((row) => row.name);
      // patch 层不去重（insert 是追加）——去重在 Loader：同 id 复用同一个 Entry，后者胜。
      // 所以这里要守的是"两层写的内容一样"，否则结果就取决于 bundle 顺序。
      expect(inserted, id).toHaveLength(2);
      expect(new Set(inserted), id).toEqual(new Set([name]));
    }
  });
});

describe("自己注册的 preset（preset-mode-switch）", () => {
  /** preset 声明的行：`config.id` 是会话里记的身份，行 id 是 `preset-<id>`。 */
  function presetRow(): Row {
    return rowById(inserted(), `preset-${MODE_PRESET_ID}`);
  }

  function presetPlugins(): readonly Row[] {
    const plugins = presetRow().config?.["plugins"];
    if (!Array.isArray(plugins)) throw new Error("preset 的 config.plugins 必须是行数组");
    return plugins as readonly Row[];
  }

  /** 深挖所有嵌套行 id（组行把子行放在 `config` 数组里）。 */
  function idsOf(rows: readonly Row[]): string[] {
    return rows.flatMap((row) => [
      row.id ?? "",
      ...idsOf(Array.isArray(row.config) ? (row.config as unknown as Row[]) : []),
    ]);
  }

  it("声明了可读的展示元数据与不撞官方 1..4 的 order", () => {
    const config = presetRow().config ?? {};

    expect(presetRow().name).toBe("@deepseek-ai/dsh-agent-preset");
    expect(config["id"]).toBe(MODE_PRESET_ID);
    expect(config["name"]).toBe("模式切换");
    expect(typeof config["description"]).toBe("string");
    expect(config["order"]).toBe(5);
  });

  it("行清单就是工具包的 preset 平面那一套（同一份真源，逐行同形）", () => {
    const declared = presetPlugins();
    const expected = TOOLKIT_PRESET_ROWS;

    // 逐行比 id 与 name：上游改包名 / 我们改族名都会在这里显形。
    const label = (value: unknown): string => (typeof value === "string" ? value : "(缺失)");
    const shapeOf = (
      rows: readonly { readonly id?: unknown; readonly name?: unknown }[],
    ): string[] => rows.map((row) => `${label(row.id)} ${label(row.name)}`);
    expect(shapeOf(declared)).toEqual(shapeOf(expected));
  });

  it("要的能力面都在：联网、文件、Shell、委派、压缩、skill 发现 provider", () => {
    const ids = new Set(idsOf(presetPlugins()));

    for (const id of [
      "tool-web",
      "tool-ask-user",
      "tool-fs",
      "tool-fs-search",
      "tool-bash",
      "tool-pwsh",
      "tool-jobs",
      "tool-subagent",
      "tool-subagent-fork",
      "tool-todo",
      "tool-goal",
      "tool-workflow",
      "skill-filesystem",
      "compaction-basic",
      "tool-result-pruner",
      "plan-mode",
    ]) {
      expect(ids.has(id), `preset 少了 ${id}`).toBe(true);
    }
  });

  it("注入面不在 preset 里：agent-instructions / tool-skill 归上游行，tool-guidance 归 host 平面", () => {
    const ids = new Set(idsOf(presetPlugins()));

    // 上游那两行是官方 preset 自带的；我们不放（让位 / 抢面逻辑照旧兜官方 preset 会话）。
    expect(ids.has("agent-instructions")).toBe(false);
    expect(ids.has("tool-skill")).toBe(false);
    // 工具说明往通道这个 host 单例注册正文：它只由本 bundle 的 host 平面插一行。
    expect(ids.has("tool-guidance")).toBe(false);
    expect(rowById(inserted(), "tool-guidance").name).toBe("@morlay/dsh-agent-toolkit/guidance");
  });

  it("两个模式都挂这一份 preset（差异由会话级收口表达）", () => {
    const modes = sessionModeRows()[0]?.insert?.[0]?.config?.["modes"] as
      | Record<string, { preset?: string }>
      | undefined;

    expect(Object.keys(modes ?? {}).sort()).toEqual(["chat", "coding"]);
    for (const [id, mode] of Object.entries(modes ?? {})) {
      expect(mode.preset, id).toBe(MODE_PRESET_ID);
    }
  });
});

describe("新会话的默认 preset", () => {
  it("配置层把 registry 的默认指向我们那份（行由 web-app 提供）", async () => {
    const theirs = yaml.load(
      await readFile(join(process.cwd(), "bundles/mydsh-profile/cordis.patch.yml"), "utf8"),
      { schema: entryListSchema },
    ) as Row[];
    const row = theirs.find((entry) => entry.id === "agent-preset-registry");

    expect(row?.config?.["default"]).toBe(MODE_PRESET_ID);
  });
});
