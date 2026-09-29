// pack 索引的两条硬规矩：一份文件一个 pack、同名不给过（归类/命名错了要当场报错，不是后者覆盖前者）。
import { describe, expect, it } from "vitest";
import { GROUP_PACKS, groupsOf, shortDescriptionsOf, TOOL_PACKS } from "../guidance/packs/index.ts";

describe("pack 索引", () => {
  it("工具族与用法组都是 pack，且 family 各自唯一", () => {
    expect(TOOL_PACKS.length).toBeGreaterThan(5);
    expect(GROUP_PACKS).toHaveLength(4);

    expect(new Set(TOOL_PACKS.map((pack) => pack.family)).size).toBe(TOOL_PACKS.length);
    expect(new Set(GROUP_PACKS.map((pack) => pack.family)).size).toBe(GROUP_PACKS.length);
  });

  it("同一个工具名出现在两个族里会 fail loud", () => {
    expect(() =>
      shortDescriptionsOf([
        { family: "a", tools: [{ tool: "read", short: "读" }] },
        { family: "b", tools: [{ tool: "read", short: "又读" }] },
      ]),
    ).toThrow(/read/u);
  });

  it("两个 pack 声明同一个组 key 会 fail loud", () => {
    const first = GROUP_PACKS[0]!;

    expect(() => groupsOf([first, { family: "dup", group: first.group }])).toThrow(/同时出现在/u);
  });
});
