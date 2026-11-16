// session-mode 的浏览器半装配：端点客户端 → 远端绑定 → 读面 store → 两个视图（composer 的 chip、右栏面板）。
//
// 除了清单本身，这里还挂着一条**跟随**：会话切换且右栏已经挂到那个会话时，把面板带到右栏。
import { inject, Injectable, provide, type Context, type OnInit } from "@morlay/zephyr";
import { SidebarRight, UiSession } from "@morlay/zephyr-app/client";
import { SessionModeEndpointClient } from "./session-mode-endpoint.client.ts";
import { SessionModeRemoteBinding } from "./session-mode-remote.binding.ts";
import { SessionModeStore } from "./session-mode.store.ts";
import { SessionModeLocales } from "./session-mode-locales.contribution.ts";
import { SessionModePanelTab } from "./session-mode-panel-tab.ts";
import { SessionModeSeatView } from "./session-mode-seat.view.tsx";
import { SessionModePanelView } from "./session-mode-panel.view.tsx";
import { PANEL_ID } from "./session-mode-slots.ts";

// 两个信号都按**最小形状**读：它们是上游行按名字发布的服务面（`sidebarRight` / `uiSession`），
// 本包只用到这两条快照源与一个命令，其余成员一概不认。
interface Signal<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}

/** 上游 `uiSession` 的面：当前会话的绑定快照（`key` 就是会话 id）。 */
interface UiSessionFace {
  readonly adapter: { readonly current: Signal<{ readonly key?: string | undefined }> };
}

/** 上游 `sidebarRight` 的面：右栏当前显示的会话与打开一个 tab。 */
interface SidebarRightFace {
  readonly mounted: Signal<string | undefined>;
  openTab(kind: string): void;
}

// 两个令牌的类型是 `unknown`（上游按名字发布服务），而装配里那一行也可能是包装行而不是上游面：
// 形状在这里判一次，不合形就不跟随（不是错误——那样只是少了自动打开）。
function followable(
  sidebarRight: SidebarRightFace | undefined,
  uiSession: UiSessionFace | undefined,
): { readonly sidebarRight: SidebarRightFace; readonly uiSession: UiSessionFace } | undefined {
  const signal = (value: unknown): boolean =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as Signal<unknown>).getSnapshot === "function" &&
    typeof (value as Signal<unknown>).subscribe === "function";
  if (sidebarRight === undefined || uiSession === undefined) return undefined;
  if (typeof sidebarRight.openTab !== "function") return undefined;
  if (!signal(sidebarRight.mounted) || !signal(uiSession.adapter?.current)) return undefined;
  return { sidebarRight, uiSession };
}

/**
 * 会话切换时把模式面板带到右栏。
 *
 * 两个信号都要订阅：`uiSession.adapter.current` 说"用户切到了哪个会话"，`sidebarRight.mounted`
 * 说"右栏已经挂到哪个会话"。首帧与切换过程中后者还没指向新会话，此时 `openTab` 会以
 * "no session surface is mounted" 抛错——所以两路都订阅，两个都指到同一个会话时才打开。
 */
@Injectable()
export class SessionModeFollowPanel implements OnInit {
  // 两行都是可选依赖：headless / 窄屏装配不一定装右栏（那就不跟随，不是错误）。
  private readonly sidebarRight = inject.optional(SidebarRight) as SidebarRightFace | undefined;

  private readonly uiSession = inject.optional(UiSession) as UiSessionFace | undefined;

  onInit(ctx: Context): void {
    const face = followable(this.sidebarRight, this.uiSession);
    if (face === undefined) return;
    const { sidebarRight, uiSession } = face;
    const current = uiSession.adapter.current;
    const mounted = sidebarRight.mounted;
    // 一次会话切换会连着来几次通知（current 与 mounted 各一路）：同一轮合并到末尾，同一会话只开一次。
    let queued = false;
    // 已经为哪个会话开过面板：同一会话的后续通知（右栏内部重挂、会话列表刷新）不再开，
    // 否则用户手动关掉的那一页会被一次无关刷新弹回来。
    let openedFor: string | undefined;
    const sync = (): void => {
      if (queued) return;
      queued = true;
      // 推迟到订阅回调之后：切换过程中右栏的 surface 还在换，同步写会抛。
      queueMicrotask(() => {
        queued = false;
        const key = current.getSnapshot().key;
        if (typeof key !== "string" || key.length === 0) return;
        // 右栏还没挂到这个会话：等 mounted 那一路的下一次回调。
        if (mounted.getSnapshot() !== key) return;
        if (openedFor === key) return;
        try {
          sidebarRight.openTab(PANEL_ID);
          openedFor = key;
        } catch {
          // 挂载与卸载之间仍可能撞上：下一次订阅回调会再试（`openedFor` 没记上），这里不当作错误。
        }
      });
    };
    const offCurrent = current.subscribe(sync);
    const offMounted = mounted.subscribe(sync);
    sync();
    ctx.effect(() => () => {
      offCurrent();
      offMounted();
    });
  }
}

// 顺序 = 依赖：客户端端点先（store 与视图都经它走 wire）；视图在最后（它们的 `onInit` 要注册到位置上）。
export const provideSessionModeUi = provide([
  SessionModeEndpointClient,
  SessionModeRemoteBinding,
  SessionModeStore,
  // 字典必须是第一条：tab 的标题/guide 文案都经它 bind。
  SessionModeLocales,
  // tab **类型**先注册：正文（PanelView）按同一个 key 挂到 `sidebar.right.pane.tab` 上。
  SessionModePanelTab,
  SessionModeSeatView,
  SessionModePanelView,
  // 跟随：会话切换且右栏已挂到它时打开面板（不提供任何服务，只是一条行为）。
  SessionModeFollowPanel,
]);
