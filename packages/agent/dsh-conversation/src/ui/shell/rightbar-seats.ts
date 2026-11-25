// 右栏的**容器装配行**（归会话域）：它 `inject(SessionController)`，所以按「装配位置跟依赖走」的判据在这里。
//
// 三层职责：
// 1. 绑定当前会话的 `SessionReference`（`sessions.retain` / `release`），给 `rightbar.session` 作用域；
// 2. 注册两层座位：`rightbar`（外壳）与 `rightbar.session`（标签条 + 正文），后者带 `store` 与 `keyedHooks`；
// 3. 注册角位展开按钮（`ExpandButton`，它要 `sessionId`）。
//
// **store 必须是控制器 adopt 的那一份**：`store.create(key)` 直接转发到 `SidebarRightRow.surfaceOf(key)`。
// 不接 dockkit：拆分 / 浮动 / 停靠 / 拖拽重排 / 房间测量都不支持（差异见 `.agents/debts/`）。
import { inject, Injectable, type OnDispose, type OnInit } from "@morlay/zephyr";
import { ExpandButton } from "@deepseek-ai/dsh-client-ui-sidebar-right/src/client/shell/ExpandButton.tsx";
import {
  Layout,
  Locale,
  Shortcuts,
  Slots,
  SidebarRightRow,
} from "@morlay/zephyr-app/client";
import { GUIDE_KIND } from "@deepseek-ai/dsh-client-ui-sidebar-right/src/client/contract/seed.ts";
import { Rightbar, RightbarGuide } from "@morlay/zephyr-ui";
import { SessionController } from "../../contract/index.ts";
import { RightbarSession } from "./rightbar-session.view.tsx";

/** `sessions.retain(...)` 的返回值（会话作用域 reference，自带 `release`）。 */
type SessionReference = ReturnType<SessionController["retain"]>;

/** 当前会话的绑定。 */
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

  /** 右栏动作面 + 本层 surface 面（P1 的两段契约）。 */
  private readonly row = inject(SidebarRightRow);

  /** 会话目录：`retain` 出容器要绑的 reference。 */
  private readonly sessions = inject(SessionController);

  /** 文案。 */
  private readonly locale = inject(Locale);

  /** 快捷键目录（角位按钮与 tabHookContext 读它）。 */
  private readonly shortcuts = inject(Shortcuts);

  /** 帧：展开状态要报给它。 */
  private readonly layout = inject(Layout);

  /** 当前绑定的会话。 */
  private current: CurrentSession | undefined;

  /** 本行注册的撤销函数。 */
  private readonly disposers: (() => void)[] = [];

  /** 交给渲染器的 store 句柄：`create` 直接取控制器 adopt 的那一份 surface。 */
  private readonly store = {
    create: (key?: string) => this.row.surfaceOf(key ?? ""),
  };

  /** 订阅「在屏会话」并注册三层座位。 */
  onInit(): void {
    this.disposers.push(this.row.mounted.subscribe(() => {
      this.sync();
    }));
    this.sync();
    this.disposers.push(this.slots.inject("rightbar", () => this.registerRow()));
    this.disposers.push(this.slots.inject("rightbar.session", () => this.registerSession()));
    this.disposers.push(this.slots.inject("sidebar.right.pane.tab", () => this.registerGuide()));
    this.disposers.push(this.slots.inject("conversation.session.header.corner", () => this.slots.register(
      {
        name: "conversation.session.header.corner",
        locale: "sidebarRight",
        store: this.store,
        inject: () => ({ hooks: { shortcuts: this.shortcuts.catalog } }),
      } as never,
      ExpandButton as never,
    )));
  }

  /** 注册外壳座位（`rightbar`）：最外层 `<aside>` + 会话作用域入口。 */
  private registerRow(): () => void {
    return this.slots.register(
      {
        name: "rightbar",
        children: { "rightbar.session": { kind: "single", scope: "session" } },
        inject: () => ({
          session: this.current?.reference,
          labels: { title: this.t("guide.title"), empty: this.t("empty") },
        }),
      } as never,
      Rightbar as never,
    );
  }

  /** 注册 session 座位（`rightbar.session`）：标签条 + 正文 + `keyedHooks.tabNavigation`。 */
  private registerSession(): () => void {
    return this.slots.register(
      {
        name: "rightbar.session",
        locale: "sidebarRight",
        store: this.store,
        keyedHooks: {
          tabNavigation: (key: string) =>
            this.row.tabDomain.occurrence(this.current?.sessionId as never, { id: key as never }).navigation,
        },
        children: {
          "sidebar.right.pane.tab": { kind: "keyed", scope: "session" },
          "sidebar.right.pane.tab.title": { kind: "keyed", scope: "session" },
        },
        inject: (sessionId: string) => ({
          sessionId,
          labels: {
            close: this.t("close"),
            empty: this.t("empty"),
            unavailable: this.t("unavailable"),
          },
          select: (tabId: string) => {
            this.row.focus(tabId as never);
          },
          close: (tabId: string) => {
            this.row.close(tabId as never);
          },
          shortcuts: this.shortcuts.catalog.getSnapshot(),
          syncPresentation: (track: boolean) => {
            if (track) this.layout.openRightbar(true, false);
            else this.layout.closeRightbar();
          },
          occurrence: (tabId: string) => {
            const occurrence = this.row.tabDomain.occurrence(sessionId as never, { id: tabId as never });
            return { signal: occurrence.signal, actions: occurrence.tabActions };
          },
        }),
      } as never,
      RightbarSession as never,
    );
  }

  /** 注册 guide 的正文座位（默认页的空态；类型注册在框架的 `GuideType`）。 */
  private registerGuide(): () => void {
    return this.slots.register(
      {
        name: "sidebar.right.pane.tab",
        key: GUIDE_KIND,
        inject: () => ({ title: this.t("guide.title"), empty: this.t("guide.empty") }),
      } as never,
      RightbarGuide as never,
    );
  }

  /** 文案函数（`rightbar` 命名空间，与上游组件的 `sidebarRight` 分开）。 */
  private t(key: string): string {
    return this.locale.bind("rightbar")(key);
  }

  /** 在屏会话变化：释放旧 reference、retain 新的。 */
  private sync(): void {
    const sessionId = this.row.mounted.getSnapshot();
    if (sessionId === this.current?.sessionId) return;
    this.current?.release();
    this.current = undefined;
    if (sessionId === undefined) return;
    const retained = this.sessions.retain(sessionId, { source: "sidebarView", facets: { conversation: true } });
    this.current = { sessionId, reference: retained, release: () => { retained.release(); } };
  }

  /** 卸载：撤注册并释放 reference。 */
  onDispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
    this.current?.release();
    this.current = undefined;
  }
}
