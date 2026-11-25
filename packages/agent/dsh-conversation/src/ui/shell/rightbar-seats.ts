// 右栏的**容器装配行**（归会话域）：它 `inject(SessionController)`，所以按「装配位置跟依赖走」的判据在这里。
//
// 职责：
// 1. 绑定当前会话的 `SessionReference`（`sessions.retain` / `release`）——容器要给 `rightbar.session` 作用域；
// 2. 注册 `rightbar`（root 外壳）与 `rightbar.session`（session 座位）两层；
// 3. 注册角位展开按钮（`ExpandButton`，它要 `sessionId`，同属会话域）。
//
// 不接 dockkit：`RightbarSeat` 那套 pane 协议（拆分/浮动/停靠/拖拽/房间测量）我们不支持，差异见
// `.agents/debts/` 里那条。
import { inject, Injectable, type OnDispose, type OnInit } from "@morlay/zephyr";
import { ExpandButton } from "@deepseek-ai/dsh-client-ui-sidebar-right/src/client/shell/ExpandButton.tsx";
import {
  ContextMenus,
  Layout,
  Locale,
  Shortcuts,
  Slots,
  SidebarRight,
} from "@morlay/zephyr-app/client";
import { Rightbar } from "@morlay/zephyr-ui";
import { SessionController } from "../../contract/index.ts";

/** `sessions.retain(...)` 的返回值（会话作用域 reference，自带 `release`）。 */
type SessionReference = ReturnType<SessionController["retain"]>;

/** 当前会话的绑定（`undefined` 表示没有会话在屏）。 */
interface CurrentSession {
  readonly sessionId: string;
  readonly reference: SessionReference;
  readonly release: () => void;
}

/** 右栏的两层座位与它的会话绑定。 */
@Injectable()
export class RightbarSeats implements OnInit, OnDispose {
  /** 槽位注册表。 */
  private readonly slots = inject(Slots);

  /** 右栏动作面（读 `mounted`，即「哪个会话在屏」）。 */
  private readonly sidebarRight = inject(SidebarRight);

  /** 会话目录：`retain` 出容器要绑的 reference。 */
  private readonly sessions = inject(SessionController);

  /** 文案（容器与角位按钮的上游文案在 `sidebarRight` 命名空间）。 */
  private readonly locale = inject(Locale);

  /** 快捷键目录（角位按钮的 tooltip 读它）。 */
  private readonly shortcuts = inject(Shortcuts);

  /** 帧：展开状态要报给它。 */
  private readonly layout = inject(Layout);

  /** 右键菜单（上游座位用它判断「菜单开着」；这里只保证服务在场）。 */
  private readonly contextMenus = inject(ContextMenus);

  /** 当前绑定的会话（切换时换一份）。 */
  private current: CurrentSession | undefined;

  /** 本行注册的撤销函数。 */
  private readonly disposers: (() => void)[] = [];

  /** 订阅「在屏会话」并注册两层座位与角位按钮。 */
  onInit(): void {
    this.disposers.push(this.sidebarRight.mounted.subscribe(() => {
      this.sync();
    }));
    this.sync();
    this.disposers.push(this.slots.inject("rightbar", () => this.slots.register(
      {
        name: "rightbar",
        children: { "rightbar.session": { kind: "single", scope: "session" } },
        inject: () => ({ session: this.current?.reference }),
      } as never,
      Rightbar as never,
    )));
    this.disposers.push(this.slots.inject("rightbar.session", () => this.slots.register(
      {
        name: "rightbar.session",
        locale: "sidebarRight",
        children: {
          "sidebar.right.pane.tab": { kind: "keyed", scope: "session" },
          "sidebar.right.pane.tab.title": { kind: "keyed", scope: "session" },
        },
        inject: () => ({
          labels: this.labels(),
          syncPresentation: (track: boolean) => {
            if (track) this.layout.openRightbar(true, false);
            else this.layout.closeRightbar();
          },
        }),
      } as never,
      Rightbar as never,
    )));
    this.disposers.push(this.slots.inject("conversation.session.header.corner", () => this.slots.register(
      {
        name: "conversation.session.header.corner",
        locale: "sidebarRight",
        inject: () => ({ hooks: { shortcuts: this.shortcuts.catalog } }),
      } as never,
      ExpandButton as never,
    )));
  }

  /** 容器文案（上游 `sidebarRight` 字典里没有「空列」这条，用自己的）。 */
  private labels(): { title: string; close: string; empty: string; unavailable: string } {
    const t = this.locale.bind("sidebarRight");
    return { title: t("chrome.expandAria"), close: t("menu.close"), empty: "", unavailable: "" };
  }

  /** 在屏会话变化：释放旧 reference、retain 新的。 */
  private sync(): void {
    const sessionId = this.sidebarRight.mounted.getSnapshot();
    if (sessionId === this.current?.sessionId) return;
    this.current?.release();
    this.current = undefined;
    if (sessionId === undefined) return;
    const retained = this.sessions.retain(sessionId, { source: "sidebarView", facets: { conversation: true } });
    this.current = {
      sessionId,
      reference: retained,
      release: () => {
        retained.release();
      },
    };
  }

  /** 卸载：撤注册并释放 reference。 */
  onDispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
    this.current?.release();
    this.current = undefined;
  }
}
