// 右栏的 **session 座位**（`rightbar.session`）：标签条 + 正文。
//
// 这一层在 session 作用域里，所以拿得到 `useStore` / `useTabNavigation` / occurrence（signal + actions）；
// 上游组件的 `useTabInfo` 需要的那份 `hookContext` 就在这里造（`tabHookContextOf`）。
// 不接 dockkit：只画「一条标签 + 一块正文」，拆分/浮动/停靠/拖拽/房间测量都不支持。
import { useEffect, type ReactNode } from "react";
import { RightbarPaneTab, RightbarTabTitle } from "@morlay/zephyr-ui";
import { tabHookContextOf, type TabHookInput } from "@morlay/zephyr-app/client";
import type { RenderOpts } from "@deepseek-ai/dsh-client-ui-slots";

/** 容器文案。 */
export interface RightbarSeatLabels {
  readonly close: string;
  readonly empty: string;
  readonly unavailable: string;
}

/** session 座位的 props。 */
export interface RightbarSessionProps {
  /** 本会话 id。 */
  readonly sessionId: string;
  /** 读本会话的布局（渲染器绑定的 store hook）。 */
  readonly useStore: TabHookInput["useStore"];
  /** 按 tab id 读导航（渲染器绑定的 keyed hook）。 */
  readonly useTabNavigation: TabHookInput["useTabNavigation"];
  /** 渲染 tab 的两个 keyed 子座位（渲染器给）。 */
  readonly renderSlot: (key: "sidebar.right.pane.tab" | "sidebar.right.pane.tab.title", owner: object, opts?: RenderOpts) => ReactNode;
  /** 文案。 */
  readonly labels: RightbarSeatLabels;
  /** 选中 / 关闭（容器的动作面）。 */
  readonly select: (tabId: string) => void;
  readonly close: (tabId: string) => void;
  /** 快捷键目录。 */
  readonly shortcuts: TabHookInput["shortcuts"];
  /** 一条记录的 occurrence（signal + 它能对自己做的动作）。 */
  readonly occurrence: (tabId: string) => TabHookInput["occurrence"];
  /** 把展开状态报给帧（`openRightbar` / `closeRightbar`）；本层读得到 store 的 `expanded`。 */
  readonly syncPresentation: (track: boolean) => void;
}

/**
 * 会话座位。
 * @param props - 会话 id、store/keyed 读面、两个子座位与动作。
 * @returns 标签条 + 正文。
 */
export function RightbarSession({
  sessionId,
  useStore,
  useTabNavigation,
  renderSlot,
  labels,
  select,
  close,
  shortcuts,
  occurrence,
  syncPresentation,
}: RightbarSessionProps): ReactNode {
  const layout = useStore(state => state.bySession[sessionId]?.layout);
  const tabs = layout === undefined ? [] : Object.values(layout.tabs);
  const pane = layout === undefined ? undefined : layout.nodes[layout.activePaneId];
  // 活动 pane 一定是 pane 节点（split 不会是 `activePaneId`），这里按 kind 收窄。
  const activeTabId = pane !== undefined && pane.kind === "pane" ? pane.activeTabId : undefined;
  const active = tabs.find(tab => tab.id === activeTabId);
  // 展开状态只存在于 store；帧的列宽由这里报给它（上游座位也是这个位置报的）。
  const expanded = layout?.expanded === true;
  useEffect(() => {
    syncPresentation(expanded);
  }, [syncPresentation, expanded]);

  const strip = tabs.map(tab => {
    const context = tabHookContextOf({
      shortcuts,
      tabId: tab.id,
      title: true,
      occurrence: occurrence(tab.id),
      useStore,
      useTabNavigation,
    });
    return (
      <RightbarTabTitle
        key={tab.id}
        title={tab.title}
        titleSlot={renderSlot("sidebar.right.pane.tab.title", {}, { entryKey: tab.kind, hookContext: context, fallback: null })}
        active={tab.id === activeTabId}
        closeLabel={labels.close}
        onSelect={() => {
          select(tab.id);
        }}
        onClose={() => {
          close(tab.id);
        }}
      />
    );
  });

  const body = active === undefined ? undefined : (() => {
    const context = tabHookContextOf({
      shortcuts,
      tabId: active.id,
      title: false,
      occurrence: occurrence(active.id),
      useStore,
      useTabNavigation,
    });
    return renderSlot("sidebar.right.pane.tab", {}, { entryKey: active.kind, hookContext: context, fallback: null });
  })();

  return (
    <>
      <div className={undefined} data-role="rightbar-strip">
        {strip}
      </div>
      <RightbarPaneTab content={body} unavailable={active === undefined ? labels.empty : labels.unavailable} />
    </>
  );
}
