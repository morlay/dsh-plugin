// `GuideBody` 注入面的判据（输入侧）：五个成员都得交出去。
//
// 端到端夹具还没搭，所以这里断言的是「注入面形状完整」，不是「渲染出了东西」。
import { describe, expect, test, vi } from "vitest";
import { guideInjectOf } from "../shell/rightbar-guide-inject.ts";

describe("GuideBody 的注入面", () => {
  test("四个 observable + setPinned 全部就位，键集合精确", () => {
    const source = { getSnapshot: () => [], subscribe: () => () => {} };
    const setPinned = vi.fn();
    const inject = guideInjectOf({
      shortcuts: source as never,
      guideEntries: source as never,
      entryPins: source as never,
      entryActions: source as never,
      setPinned,
    });
    expect(Object.keys(inject).sort()).toEqual(["hooks", "setPinned"]);
    expect(Object.keys(inject.hooks).sort()).toEqual(["entryActions", "entryPins", "guideEntries", "shortcuts"]);
    expect(inject.setPinned).toBe(setPinned);
    expect(inject.hooks.shortcuts).toBe(source);
    expect(inject.hooks.guideEntries).toBe(source);
    expect(inject.hooks.entryPins).toBe(source);
    expect(inject.hooks.entryActions).toBe(source);
  });
});
