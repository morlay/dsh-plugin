// 本包的实体就是清单：preset 引用它、profile 可以装配它，两边同一份真源。
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { entryListSchema } from "@deepseek-ai/cordis-plugin-include";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { CHAT_TOOLKIT_ROWS, TOOLKIT_ROWS } from "../rows.ts";
import { renderPatch } from "../../tool/patch.ts";

describe("功能行清单", () => {
  it("每行 id 唯一，且都指向上游能力包（组行看它自己的子行）", () => {
    const ids = TOOLKIT_ROWS.map((row) => row.id);

    expect(new Set(ids).size).toBe(ids.length);
    const check = (name: string, id: string): void => {
      expect(name === "cordis:group" || name.startsWith("@deepseek-ai/dsh-"), id).toBe(true);
    };
    for (const row of TOOLKIT_ROWS) {
      check(row.name, row.id);
      if (row.group !== true) continue;
      for (const child of row.config as readonly { id: string; name: string }[]) {
        check(child.name, child.id);
      }
    }
  });

  it("覆盖本模式的全部能力面（清单缩水会在这里显形）", () => {
    const ids = new Set(TOOLKIT_ROWS.map((row) => row.id));

    for (const id of [
      "tool-bash",
      "tool-pwsh",
      "tool-fs",
      "tool-fs-search",
      "tool-jobs",
      "skill-filesystem",
      "command-goal",
      "tool-goal",
      "compaction",
      "delegation",
      "tool-ask-user",
      "tool-todo",
      "tool-web",
      "present",
    ]) {
      expect(ids.has(id), `功能行清单少了 ${id}`).toBe(true);
    }
  });

  it("对话模式的行是同一份清单里的两件", () => {
    const all = TOOLKIT_ROWS.map((row) => row.id);

    for (const row of CHAT_TOOLKIT_ROWS) expect(all).toContain(row.id);
    expect(CHAT_TOOLKIT_ROWS.map((row) => row.id)).toEqual(["tool-ask-user", "tool-web"]);
  });

  it("bundle patch 里还有工具说明行与默认关闭的 Agent Teams 组", async () => {
    interface Row {
      id?: string;
      name?: string;
      disabled?: boolean | { __jsExpr: string };
      /** `cordis:group` 的子行。 */
      config?: Row[];
      insert?: Row[];
    }
    const layers = yaml.load(
      await readFile(join(process.cwd(), "packages/profile/dsh-agent-toolkit/cordis.patch.yml"), "utf8"),
      { schema: entryListSchema },
    ) as Row[];
    const inserted = layers.flatMap((row) => row.insert ?? []);

    // 工具说明：profile 平面装一次（它 inject 通道，通道也在这一层）。
    expect(inserted.find((row) => row.id === "tool-guidance")?.name).toBe(
      "@morlay/dsh-agent-toolkit/guidance",
    );

    // Agent Teams：默认关闭的组（`DSH_AGENT_TEAM=1` 才装），直接派发那几行在团队开启时让位。
    const team = inserted.find((row) => row.id === "agent-team");
    expect(team?.name).toBe("cordis:group");
    expect(team?.disabled).toEqual({ __jsExpr: 'process.env.DSH_AGENT_TEAM !== "1"' });
    const delegation = inserted.find((row) => row.id === "delegation");
    expect(
      delegation?.config?.find((row) => row.id === "tool-subagent")?.disabled,
    ).toEqual({ __jsExpr: 'process.env.DSH_AGENT_TEAM === "1"' });
  });

  it("bundle patch 把整套行插到 host 平面", async () => {
    const stored = await readFile(
      join(process.cwd(), "packages/profile/dsh-agent-toolkit/cordis.patch.yml"),
      "utf8",
    );

    expect(stored).toBe(renderPatch());
    expect(renderPatch().startsWith("# 本文件由 packages/profile/dsh-agent-toolkit/tool/patch.ts 生成"))
      .toBe(true);
  });
});
