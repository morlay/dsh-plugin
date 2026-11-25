// `TabHookContext`：上游 tab 座位（`sidebar.right.pane.tab.title` 的 `useTabInfo`、chain/entry 的 tabInfo）
// 需要的那份渲染期上下文。**形状照抄上游 `tab-info.ts` 的 `TabHookContext`**（9 个字段），值来自我们的
// registry / store / 会话域 occurrence，不复制上游的渲染协议。
//
// 为什么在框架层：它只是「类型 + 纯函数」，只认 tabId / signal / actions / 两个渲染器绑定，**不认识 sessions**
// ——容器（会话域）负责取值喂进来，这里只把形状拼对。
//
// 三处退化（差异记在 `dsh-conversation/.agents/debts/`）：
// - `fullscreen` 恒 `false`：不接全屏，上游 `visible` 判断退化成「展开即可见」；
// - `active` 恒 `true`：不保留后台会话视图，渲染中的就是当前会话，`visible` 因此总是可见；
// - `useTabNavigation` 来自容器在 session 座位注册里声明的 `keyedHooks.tabNavigation`（渲染器绑定），不是自造。
import type { ShortcutCatalogEntry } from "@deepseek-ai/dsh-client-shortcuts/client";
import type { KeyedSnapshotSelectorHook, PropsStore } from "@deepseek-ai/dsh-client-ui-slots";
import type {
  SidebarRightTabActions,
  SidebarRightTabNavigation,
} from "@deepseek-ai/dsh-client-ui-sidebar-right/src/client/contract/slots.ts";
import type { createSidebarRightStore } from "@deepseek-ai/dsh-client-ui-sidebar-right/src/client/stores.ts";

/** 一个 tab 记录的运行期上下文（上游 `TabHookContext` 同形）。 */
export interface TabHookContext {
  /** 快捷键目录（`page.refresh` 这类提示读它）。 */
  readonly shortcuts: readonly ShortcutCatalogEntry[];
  /** 记录 id。 */
  readonly tabId: string;
  /** 这个座位是不是**标题**座位。 */
  readonly title: boolean;
  /** 面板是否全屏（退化：恒 `false`）。 */
  readonly fullscreen: boolean;
  /** 这个 tab 的会话是否在屏（退化：恒 `true`）。 */
  readonly active: boolean;
  /** 这条记录的 occurrence 生命周期信号。 */
  readonly signal: AbortSignal;
  /** 这个 tab 能对自己做的动作。 */
  readonly actions: SidebarRightTabActions;
  /** 会话 store 的读面（渲染器绑定）。 */
  readonly useStore: PropsStore<ReturnType<typeof createSidebarRightStore>>["useStore"];
  /** 按 tab id 读它最近一次导航（渲染器绑定的 keyed hook）。 */
  readonly useTabNavigation: KeyedSnapshotSelectorHook<SidebarRightTabNavigation>;
}

/** 造 context 需要的输入（容器给）。 */
export interface TabHookInput {
  readonly shortcuts: readonly ShortcutCatalogEntry[];
  readonly tabId: string;
  readonly title: boolean;
  readonly occurrence: { readonly signal: AbortSignal; readonly actions: SidebarRightTabActions };
  readonly useStore: TabHookContext["useStore"];
  readonly useTabNavigation: TabHookContext["useTabNavigation"];
}

/**
 * 由容器给的值造一个 `TabHookContext`。
 * @param input - 快捷键目录、记录 id、座位种类、occurrence 与两个渲染器绑定。
 * @returns 上游座位组件的 hookContext。
 */
export function tabHookContextOf(input: TabHookInput): TabHookContext {
  return {
    shortcuts: input.shortcuts,
    tabId: input.tabId,
    title: input.title,
    // 退化 1：不接全屏。
    fullscreen: false,
    // 退化 2：不保留后台会话视图。
    active: true,
    signal: input.occurrence.signal,
    actions: input.occurrence.actions,
    useStore: input.useStore,
    useTabNavigation: input.useTabNavigation,
  };
}
