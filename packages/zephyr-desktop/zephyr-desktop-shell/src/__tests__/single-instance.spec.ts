import { describe, expect, test } from "@morlay/zephyr/testing";
import { focusWindowOf, type FocusTarget } from "../single-instance.ts";

/** 记录调用顺序的假窗口。 */
function fakeWindow(options: { minimized: boolean; destroyed?: boolean }): {
  window: FocusTarget;
  calls: string[];
} {
  const calls: string[] = [];
  const window: FocusTarget = {
    isDestroyed: () => options.destroyed === true,
    isMinimized: () => options.minimized,
    restore: () => void calls.push("restore"),
    show: () => void calls.push("show"),
    focus: () => void calls.push("focus"),
  };
  return { window, calls };
}

describe("第二个实例：聚焦已有窗口", () => {
  test("最小化时先恢复、再显示、最后聚焦", () => {
    const { window, calls } = fakeWindow({ minimized: true });
    expect(focusWindowOf(window)).toBe("focused");
    expect(calls).toEqual(["restore", "show", "focus"]);
  });

  test("正常窗口：只显示与聚焦", () => {
    const { window, calls } = fakeWindow({ minimized: false });
    expect(focusWindowOf(window)).toBe("focused");
    expect(calls).toEqual(["show", "focus"]);
  });

  test("窗口已经销毁：什么都不做（第二个实例照样退出）", () => {
    const { window, calls } = fakeWindow({ minimized: false, destroyed: true });
    expect(focusWindowOf(window)).toBe("none");
    expect(calls).toEqual([]);
  });

  test("还没有窗口：什么都不做", () => {
    expect(focusWindowOf(undefined)).toBe("none");
  });
});
