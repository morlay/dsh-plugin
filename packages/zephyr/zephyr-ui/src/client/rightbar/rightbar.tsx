// 右栏容器座位：占据帧的右列，画标签条与正文。
//
// 槽位名沿用上游（`sidebar.right.pane.tab` / `.title`）：上游那几个行把正文硬编码注册在这两个名字上。
//
// 子槽是 session 作用域，本座位挂在 root 位置（`rightbar`）。正文与标题都由这里套 `ScopeBindingProvider`：
// 会话由 `binding`（session 作用域源）给定，不需要 SessionReference。
//
// **注意**：`renderSlot` 的形状是上游 `RenderSlotFn`——`(key, owner, opts?: RenderOpts)`，
// `RenderOpts = { entryKey?, only?, fallback?, hookContext? }`；不要自己发明两参或必填 `entryKey` 的窄形状。
import { useEffect, type ReactNode } from "react";
import { ScopeBindingProvider } from "@deepseek-ai/dsh-client-ui-renderer/src/client/bindings.tsx";
import type { RenderOpts, StandardSourceBinding } from "@deepseek-ai/dsh-client-ui-slots";
import { RightbarPaneTab } from "./rightbar-pane-tab.tsx";
import { RightbarTabTitle } from "./rightbar-tab-title.tsx";
import css from "./rightbar.module.css";

/** 标签条上的一个标签。 */
export interface RightbarTab {
  /** 记录的 id。 */
  readonly id: string;
  /** 记录里开 tab 时抓到的标题（标题座位的兜底）。 */
  readonly title: string;
  /** 类型注册表里这个 kind 的类型 id（keyed 座位的 key）；没登记就是 `undefined`。 */
  readonly typeId: string | undefined;
}

/** 右栏的视图快照（座位行给，组件只读）。 */
export interface RightbarView {
  /** 面板是否展开。 */
  readonly expanded: boolean;
  /** 当前会话的 scope 绑定；没有会话时 `undefined`。 */
  readonly binding: StandardSourceBinding | undefined;
  /** 当前会话的标签（按记录顺序）。 */
  readonly tabs: readonly RightbarTab[];
  /** 当前活动标签的记录 id。 */
  readonly activeTabId: string | undefined;
}

/** 渲染右栏子座位的回调（形状 = 上游 `RenderSlotFn`：`opts` 可选）。 */
export type RightbarRenderSlot = (
  key: "sidebar.right.pane.tab" | "sidebar.right.pane.tab.title",
  owner: object,
  opts?: RenderOpts,
) => ReactNode;

/** 容器文案。 */
export interface RightbarLabels {
  /** 面板的无障碍名。 */
  readonly title: string;
  /** 关闭一个标签。 */
  readonly close: string;
  /** 一个标签都没有。 */
  readonly empty: string;
  /** 类型没注册正文。 */
  readonly unavailable: string;
}

/** 容器座位的 props（都由座位行给）。 */
export interface RightbarProps {
  /** 读右栏视图（框架绑定的 selector hook）。 */
  readonly useRightbar: <T>(select: (view: RightbarView) => T) => T;
  /** 文案。 */
  readonly labels: RightbarLabels;
  /** 选中一个标签。 */
  readonly select: (tabId: string) => void;
  /** 关掉一个标签。 */
  readonly close: (tabId: string) => void;
  /** 把展开状态报给帧。 */
  readonly syncPresentation: (track: boolean) => void;
  /** 帧给的视口宽度。 */
  readonly viewportWidth: number;
  /** 渲染两个子座位（框架给）。 */
  readonly renderSlot: RightbarRenderSlot;
}

/** 窄帧阈值：与上游一致。 */
const NARROW_VIEWPORT = 768;

/**
 * 右栏容器。
 * @param props - 视图 hook、文案、三个动作与子座位渲染。
 * @returns 右列元素。
 */
export function Rightbar({
  useRightbar,
  labels,
  select,
  close,
  syncPresentation,
  viewportWidth,
  renderSlot,
}: RightbarProps): ReactNode {
  const { expanded, binding, tabs, activeTabId } = useRightbar(view => view);
  const track = expanded && viewportWidth >= NARROW_VIEWPORT;
  useEffect(() => {
    syncPresentation(track);
  }, [syncPresentation, track]);

  const active = tabs.find(tab => tab.id === activeTabId);
  const strip = tabs.map(tab => (
    <RightbarTabTitle
      key={tab.id}
      title={tab.title}
      titleSlot={
        tab.typeId === undefined
          ? undefined
          : renderSlot("sidebar.right.pane.tab.title", {}, { entryKey: tab.typeId, fallback: null })
      }
      active={tab.id === activeTabId}
      closeLabel={labels.close}
      onSelect={() => {
        select(tab.id);
      }}
      onClose={() => {
        close(tab.id);
      }}
    />
  ));

  if (binding === undefined) {
    return (
      <aside className={css.panel} aria-label={labels.title} data-role="rightbar" hidden={!expanded}>
        <div className={css.strip}>{strip}</div>
        <RightbarPaneTab content={undefined} unavailable={labels.empty} />
      </aside>
    );
  }

  return (
    <aside className={css.panel} aria-label={labels.title} data-role="rightbar" hidden={!expanded}>
      <ScopeBindingProvider binding={binding}>
        <div className={css.strip}>{strip}</div>
        <RightbarPaneTab
          content={
            active?.typeId === undefined
              ? undefined
              : renderSlot("sidebar.right.pane.tab", {}, { entryKey: active.typeId, fallback: null })
          }
          unavailable={active === undefined ? labels.empty : labels.unavailable}
        />
      </ScopeBindingProvider>
    </aside>
  );
}
