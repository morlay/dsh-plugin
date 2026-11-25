// 右栏外壳的真渲染用例：`render()` 走真 React。
//
// **props 来源判据**：外壳只认「注册行 inject 给的」（`session`/`labels`）与「渲染器/父给的」
// （`canShow`/`renderSlot`/`SessionProvider`）；不出现旧实现自己发明的字段。
// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { Rightbar, type RightbarLabels } from "../rightbar.tsx";
import { RightbarPaneTab } from "../rightbar-pane-tab.tsx";

const labels: RightbarLabels = { title: "右侧面板", empty: "没有会话在屏" };

describe("右栏外壳（真渲染）", () => {
  test("没有会话时只出说明，且不渲染 session 子座位", () => {
    const renderSlot = vi.fn(() => { throw new Error("没有会话时不该渲染 session 子座位"); });
    const SessionProvider = vi.fn(({ children }: { children: unknown }) => children as never);
    render(
      <Rightbar
        session={undefined}
        labels={labels}
        canShow={false}
        renderSlot={renderSlot}
        SessionProvider={SessionProvider as never}
      />,
    );
    expect(screen.getByText(labels.empty)).toBeTruthy();
    expect(renderSlot).not.toHaveBeenCalled();
    expect(SessionProvider).not.toHaveBeenCalled();
    cleanup();
  });

  test("有会话时 SessionProvider 包住子座位，renderSlot 只带 key 与 owner", () => {
    const reference = { sessionId: "s1" };
    const renderSlot = vi.fn(() => <p data-role="seat">session 座位</p>);
    const SessionProvider = vi.fn(({ session, children }: { session?: unknown; children: unknown }) => (
      <div data-role="session-area" data-session={JSON.stringify(session)}>{children as never}</div>
    ));
    render(
      <Rightbar
        session={reference}
        labels={labels}
        canShow
        renderSlot={renderSlot}
        SessionProvider={SessionProvider as never}
      />,
    );
    expect(screen.getByRole("complementary")).toBeTruthy();
    expect(screen.getByRole("complementary").firstElementChild?.getAttribute("data-role")).toBe("session-area");
    expect(screen.getByText("session 座位")).toBeTruthy();
    expect(renderSlot).toHaveBeenCalledWith("rightbar.session", {});
    cleanup();
  });
});

describe("正文外壳（真渲染）", () => {
  test("ReactNode 直接渲染", () => {
    render(<RightbarPaneTab content={<p>真实内容</p>} unavailable="缺口" />);
    expect(screen.getByText("真实内容")).toBeTruthy();
    expect(screen.queryByText("缺口")).toBeNull();
    cleanup();
  });

  test("空值出说明", () => {
    render(<RightbarPaneTab content={null} unavailable="缺口" />);
    expect(screen.getByText("缺口")).toBeTruthy();
    cleanup();
  });
});
