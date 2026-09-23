// 本包的实体就是清单：preset 引用它、profile 可以装配它，两边同一份真源。
import { readFile } from "node:fs/promises";
import { join } from "node:path";
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
