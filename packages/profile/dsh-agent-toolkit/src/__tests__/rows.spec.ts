// 本包的实体就是清单：preset 引用它、profile 可以装配它，两边同一份真源。
import { describe, expect, it } from "vitest";
import {
  CHAT_TOOLKIT_ROWS,
  PLAN_MODE_SECTION,
  TOOLKIT_EXTRA_ROWS,
  TOOLKIT_PLAN_ROWS,
  TOOLKIT_PRESET_ROWS,
  TOOLKIT_ROWS,
  type PresetRow,
} from "../rows.ts";
import { TOOL_PACKS } from "../guidance/packs/index.ts";

/** 组内的子行；`config` 不是数组时没有子行。 */
function children(row: PresetRow): readonly PresetRow[] {
  return Array.isArray(row.config) ? (row.config as readonly PresetRow[]) : [];
}

/** 清单里出现的全部行 id（含族组的子行）。 */
function idsOf(rows: readonly PresetRow[]): string[] {
  return rows.flatMap((row) => [row.id, ...idsOf(children(row))]);
}

/** 整套清单：按族分组的工具行 + 不属于任何族的行（压缩与工具说明）。 */
const ALL_ROWS: readonly PresetRow[] = [...TOOLKIT_ROWS, ...TOOLKIT_EXTRA_ROWS];

describe("功能行清单", () => {
  it("按工具族分组：组 id 与汉化数据的族同名同序，且行 id 唯一", () => {
    // 带上 `toolkit-` 前缀：装配按 id 全局对应，裸族名（`web` / `skill`）会被上游同名行占用。
    expect(TOOLKIT_ROWS.map((row) => row.id)).toEqual(
      TOOL_PACKS.map((pack) => `toolkit-${pack.family}`),
    );

    const ids = idsOf(TOOLKIT_ROWS);
    expect(new Set(ids).size).toBe(ids.length);
    const check = (name: string, id: string): void => {
      expect(name === "cordis:group" || name.startsWith("@deepseek-ai/dsh-"), id).toBe(true);
    };
    for (const row of TOOLKIT_ROWS) {
      check(row.name, row.id);
      for (const child of children(row)) check(child.name, child.id);
    }
  });

  it("覆盖本模式的全部能力面（清单缩水会在这里显形）", () => {
    const ids = new Set(idsOf(ALL_ROWS));

    for (const id of [
      "tool-bash",
      "tool-pwsh",
      "tool-fs",
      "tool-fs-search",
      "tool-jobs",
      "skill-filesystem",
      "command-goal",
      "tool-goal",
      "compaction-basic",
      "tool-subagent",
      "tool-ask-user",
      "tool-todo",
      "tool-web",
      "present",
    ]) {
      expect(ids.has(id), `功能行清单少了 ${id}`).toBe(true);
    }
  });

  it("对话模式的行是同一份清单里的两件", () => {
    const all = idsOf(ALL_ROWS);

    for (const row of CHAT_TOOLKIT_ROWS) expect(all).toContain(row.id);
    expect(CHAT_TOOLKIT_ROWS.map((row) => row.id)).toEqual(["tool-ask-user", "tool-web"]);
  });

  it("preset 平面那一套：每会话的能力行齐、host 平面的工具说明行不在", () => {
    const presetIds = new Set(idsOf(TOOLKIT_PRESET_ROWS));

    for (const id of [
      "tool-fs",
      "tool-fs-search",
      "tool-bash",
      "tool-pwsh",
      "tool-subagent",
      "tool-subagent-fork",
      "tool-workflow",
      "workflow-ptc",
      "tool-todo",
      "tool-goal",
      "command-goal",
      "tool-ask-user",
      "tool-web",
      "skill-filesystem",
      "compaction-basic",
      "command-compact",
      "tool-result-pruner",
      "plan-mode",
    ]) {
      expect(presetIds.has(id), `preset 平面少了 ${id}`).toBe(true);
    }
    // 工具说明往通道这个 host 单例注册正文：两个平面各一份会互相顶掉。
    expect(presetIds.has("tool-guidance")).toBe(false);
    expect(idsOf(TOOLKIT_EXTRA_ROWS)).toContain("tool-guidance");
  });

  it("带 isolate realm 的组：委派 / 压缩 / 计划模式（preset realm 要求服务隔离）", () => {
    const isolated = TOOLKIT_PRESET_ROWS.filter((entry) => entry.isolate !== undefined).map(
      (entry) => entry.id,
    );

    expect(isolated).toEqual(["toolkit-delegation", "compaction", "planning"]);
  });

  it("计划模式那一组：组形照上游，规则正文我们自己的中文契约", () => {
    const [planning] = TOOLKIT_PLAN_ROWS;
    const inner = children(planning!);

    expect(planning?.id).toBe("planning");
    expect(planning?.isolate).toEqual({ planMode: true });
    expect(inner.map((entry) => entry.id)).toEqual(["plan-mode"]);
    // `plan-mode` 的 `section` 是必填项（缺 / 空都会在装载时抛），所以这一行必须带上它。
    expect((inner[0]?.config as Record<string, unknown> | undefined)?.["section"]).toBe(
      PLAN_MODE_SECTION,
    );
    // 契约六件事的锚点：进入 / 只读 / 规则优先 / 自己查 / 提交与驳回。
    for (const anchor of [
      "exit_plan_mode",
      "一直留在计划模式",
      "不要做任何写操作",
      "压过任何后续工具说明",
      "ask_user_question",
      "todo_write",
      "唯一且最后的工具调用",
    ]) {
      expect(PLAN_MODE_SECTION, `规则正文少了 ${anchor}`).toContain(anchor);
    }
  });
});
