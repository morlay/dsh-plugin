// 本包的实体就是清单：preset 引用它、profile 可以装配它，两边同一份真源。
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { entryListSchema } from "@deepseek-ai/cordis-plugin-include";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { CHAT_TOOLKIT_ROWS, TOOLKIT_EXTRA_ROWS, TOOLKIT_ROWS, type PresetRow } from "../rows.ts";
import { TOOL_PACKS } from "../guidance/packs/index.ts";
import { renderPatch } from "../../tool/patch.ts";

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

  it("bundle patch 里还有工具说明行与默认关闭的 Agent Teams 族", async () => {
    interface Row {
      id?: string;
      name?: string;
      disabled?: boolean | { __jsExpr: string };
      /** `cordis:group` 的子行。 */
      config?: Row[];
      insert?: Row[];
    }
    const layers = yaml.load(
      await readFile(
        join(process.cwd(), "packages/profile/dsh-agent-toolkit/cordis.patch.yml"),
        "utf8",
      ),
      { schema: entryListSchema },
    ) as Row[];
    const inserted = layers.flatMap((row) => row.insert ?? []);

    // 工具说明：profile 平面装一次（它 inject 通道，通道也在这一层且不隔离）。
    expect(inserted.find((row) => row.id === "tool-guidance")?.name).toBe(
      "@morlay/dsh-agent-toolkit/guidance",
    );

    // Agent Teams 族：默认关闭写在行上（组级 `disabled` 被 Loader 忽略），组 id 就是族名。
    const team = inserted.find((row) => row.id === "toolkit-team");
    expect(team?.name).toBe("cordis:group");
    expect(team?.disabled).toBeUndefined();
    expect(team?.config?.map((row) => row.id)).toEqual([
      "agent-team",
      "tool-agent-team",
      "ui-agent-team",
    ]);
    for (const row of team?.config ?? [])
      expect(row.disabled).toEqual({ __jsExpr: 'process.env.DSH_AGENT_TEAM !== "1"' });

    const delegation = inserted.find((row) => row.id === "toolkit-delegation");
    expect(delegation?.config?.find((row) => row.id === "tool-subagent")?.disabled).toEqual({
      __jsExpr: 'process.env.DSH_AGENT_TEAM === "1"',
    });

    // 装配按 id 全局对应：组行与子行同 id 时，后者会覆盖前者的 id 映射，patch 只打得到子行。
    const ids: string[] = [];
    const collect = (rows: readonly Row[]): void => {
      for (const row of rows) {
        if (row.id !== undefined) ids.push(row.id);
        if (Array.isArray(row.config)) collect(row.config);
      }
    };
    collect(inserted);
    const duplicated = ids.filter((id, index) => ids.indexOf(id) !== index);
    expect(duplicated, `重复 id: ${duplicated.join(", ")}`).toEqual([]);
  });

  it("bundle patch 把整套行插到 host 平面", async () => {
    const stored = await readFile(
      join(process.cwd(), "packages/profile/dsh-agent-toolkit/cordis.patch.yml"),
      "utf8",
    );

    expect(stored).toBe(renderPatch());
    expect(
      renderPatch().startsWith("# 本文件由 packages/profile/dsh-agent-toolkit/tool/patch.ts 生成"),
    ).toBe(true);
  });
});
