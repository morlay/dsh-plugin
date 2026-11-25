// 外壳的 **props 来源判据**（机器化）：外壳只认两类字段，多一个都算「第三类」。
//
// ① 注册行 `inject` 给的：`session` / `labels`
// ② 渲染器/父给的：`canShow`（AppFrame owner props）/ `renderSlot` / `SessionProvider`
//
// 断言用**精确相等**：渲染器以后多注入了什么字段，这条先红（那正是要拦的「第三类 prop」）。
// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { Rightbar, type RightbarProps } from "../rightbar.tsx";

/** 允许清单：外壳的 props 只允许这五个键（来源见文件头）。 */
const ALLOWED = ["SessionProvider", "canShow", "labels", "renderSlot", "session"] as const;

describe("右栏外壳的 props 来源", () => {
  test("收到的 props 键集合精确等于允许清单", () => {
    const received: string[][] = [];
    function Probe(props: RightbarProps) {
      received.push(Object.keys(props).sort());
      return <Rightbar {...props} />;
    }
    const props: RightbarProps = {
      session: undefined,
      labels: { title: "右侧面板", empty: "没有会话在屏" },
      canShow: false,
      renderSlot: vi.fn(() => null),
      SessionProvider: vi.fn(({ children }: { children: unknown }) => children as never) as never,
    };
    render(<Probe {...props} />);
    expect(received[0]).toEqual([...ALLOWED].sort());
    cleanup();
  });
});
