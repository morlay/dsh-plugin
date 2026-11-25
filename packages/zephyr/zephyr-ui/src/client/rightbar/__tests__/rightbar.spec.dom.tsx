// 右栏容器的真渲染用例：`render()` 走真 React（这条 bug 就是「测试绿但没真渲染」漏掉的）。
//
// 覆盖：① keyed 座位的 key 通过 `opts.entryKey` 交出去；② 没有会话绑定时只出说明、不碰 session 子座位；
// ③ 正文位拿到 ReactNode 时正常渲染；④ 空值出说明。
// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { StandardSourceBinding } from "@deepseek-ai/dsh-client-ui-slots";
import { Rightbar, type RightbarLabels, type RightbarView } from "../rightbar.tsx";
import { RightbarPaneTab } from "../rightbar-pane-tab.tsx";

const labels: RightbarLabels = {
  title: "右侧面板",
  close: "关闭标签",
  empty: "没有打开的标签",
  unavailable: "这个标签的正文还没有注册",
};

/** 一个能当 session 绑定用的最小值（组件只透传给 ScopeBindingProvider）。 */
const binding = { key: "s1", hooks: {}, keyedHooks: {}, props: {} } as unknown as StandardSourceBinding;

/**
 * 造一个 view hook（真 selector 语义，不订阅外部源）。
 * @param view - 要返回的快照。
 * @returns `useRightbar`。
 */
function viewOf(view: RightbarView) {
  return <T,>(select: (value: RightbarView) => T): T => select(view);
}

describe("右栏容器（真渲染）", () => {
  test("keyed 座位按类型 id 传 entryKey，正文渲染出座位内容", () => {
    const renderSlot = vi.fn((key: string, _owner: object, opts?: { entryKey?: string }) =>
      key === "sidebar.right.pane.tab"
        ? <p data-role="slot-body">正文:{opts?.entryKey}</p>
        : <span data-role="slot-title">标题:{opts?.entryKey}</span>);
    render(
      <Rightbar
        useRightbar={viewOf({
          expanded: true,
          binding,
          tabs: [{ id: "t1", title: "浏览器", typeId: "browser-type" }],
          activeTabId: "t1",
        })}
        labels={labels}
        select={() => {}}
        close={() => {}}
        syncPresentation={() => {}}
        viewportWidth={1280}
        renderSlot={renderSlot}
      />,
    );
    expect(screen.getByRole("complementary")).toBeTruthy();
    expect(screen.getByText("正文:browser-type")).toBeTruthy();
    expect(screen.getByText("标题:browser-type")).toBeTruthy();
    expect(renderSlot).toHaveBeenCalledWith("sidebar.right.pane.tab", {}, expect.objectContaining({ entryKey: "browser-type" }));
    cleanup();
  });

  test("没有会话绑定时只画标签条与说明，不碰 session 子座位", () => {
    const renderSlot = vi.fn(() => {
      throw new Error("没有绑定时不该渲染 session 子座位");
    });
    render(
      <Rightbar
        useRightbar={viewOf({ expanded: false, binding: undefined, tabs: [], activeTabId: undefined })}
        labels={labels}
        select={() => {}}
        close={() => {}}
        syncPresentation={() => {}}
        viewportWidth={1280}
        renderSlot={renderSlot}
      />,
    );
    expect(screen.getByText(labels.empty)).toBeTruthy();
    expect(renderSlot).not.toHaveBeenCalled();
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
