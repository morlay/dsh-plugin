// `commands/list` 的条目映射：上游 descriptor → 我们给浏览器的形状。
//
// 为什么值得单独钉：客户端的 `/` 面板按 **`definitionId`** 认内置命令
// （`ui-commands` 的 `builtinCommandName`：`Object.keys(BUILTINS).find(n => d.definitionId === BUILTINS[n])`），
// 认出来才有 `builtinRowFace` 的本地化 label / description / icon。少这个字段不会报错，
// 只是面板上那几行退回宿主给的英文说明、也没有图标。
import { describe, expect, it } from "vitest";
import { commandEntryOf } from "../server/command-entry-of.ts";

describe("命令条目的对外形状", () => {
  it("`definitionId` 原样带上（`/` 面板靠它认内置命令）", () => {
    const entry = commandEntryOf({
      name: "compact",
      definitionId: "@deepseek-ai/dsh-command-compact",
      description: "Compact older conversation history",
    } as never);
    expect(entry).toMatchObject({
      name: "compact",
      definitionId: "@deepseek-ai/dsh-command-compact",
      description: "Compact older conversation history",
    });
  });

  it("没有 `definitionId` 时不写这个键（`exactOptionalPropertyTypes` 下 `undefined` 不是缺省）", () => {
    const entry = commandEntryOf({ name: "custom", description: "自定义" } as never);
    expect(Object.hasOwn(entry, "definitionId")).toBe(false);
    expect(Object.hasOwn(entry, "input")).toBe(false);
  });

  it("有输入提示时带上 `input`", () => {
    const entry = commandEntryOf({
      name: "permission",
      description: "Switch the permission preset",
      input: { hint: "<preset>" },
    } as never);
    expect(entry.input).toEqual({ hint: "<preset>" });
  });
});
