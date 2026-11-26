// 右栏座位（归会话域）：**直接渲染上游组件** `RightbarRoot` / `RightbarSeat`，不再自己实现壳。
//
// 之前不敢用的原因是它们依赖 `sessions`；现在座位本来就在会话域（`inject(SessionController)`），那个阻塞消失。
// 我们只做装配：`SidebarSessionViews`（每会话 reference）、store（控制器 adopt 的那一份）、`SidebarRightInjected`、
// guide 的类型与正文/标题注册、角位 `ExpandButton`。壳内的一切（dockkit 的 pane、拆分布局、标签条）都是上游的。
import { inject, Injectable, type OnDispose, type OnInit } from "@morlay/zephyr";
import {
  ContextMenus,
  Layout,
  Locale,
  Shortcuts,
  Slots,
  SidebarRightRow,
  SidebarRightTabs,
} from "@morlay/zephyr-app/client";
import { createSidebarRightStore } from "@deepseek-ai/dsh-client-ui-sidebar-right/src/client/stores.ts";
import { defaultSeed } from "@deepseek-ai/dsh-client-ui-sidebar-right/src/client/contract/seed.ts";
import {
  RightbarSeat,
  type SidebarRightInjected,
} from "@deepseek-ai/dsh-client-ui-sidebar-right/src/client/shell/SidebarRight.tsx";
import { RightbarRoot } from "@deepseek-ai/dsh-client-ui-sidebar-right/src/client/shell/RightbarRoot.tsx";
import { ExpandButton } from "@deepseek-ai/dsh-client-ui-sidebar-right/src/client/shell/ExpandButton.tsx";
import { GuideBody, type GuideInjected } from "@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tabs/guide/GuideBody.tsx";
import { GuideTitle } from "@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tabs/guide/GuideTitle.tsx";
import { GUIDE_ID, guideDefinition } from "@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tabs/guide/definition.ts";
import { createGuidePins } from "@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tabs/guide/guide-pins.ts";
import {
  guideTabInfoFactory,
  tabInfoFactory,
} from "@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-info.ts";
import { SidebarSessionViews } from "@deepseek-ai/dsh-client-ui-sidebar-right/src/client/session-views.ts";
import { SessionController } from "../../contract/index.ts";

/** 上游右栏文案命名空间（组件内部的 `t` 都读它，字典由框架的 `SidebarRightDefault` 注册）。 */
const NS = "sidebarRight";

/** 右栏座位装配行：两个座位 + 角位按钮 + guide 的类型/正文/标题，全部是上游组件。 */
@Injectable()
export class RightbarSeats implements OnInit, OnDispose {
  private readonly slots = inject(Slots);

  private readonly row = inject(SidebarRightRow);

  private readonly tabs = inject(SidebarRightTabs);

  private readonly sessions = inject(SessionController);

  private readonly locale = inject(Locale);

  private readonly shortcuts = inject(Shortcuts);

  private readonly layout = inject(Layout);

  private readonly contextMenus = inject(ContextMenus);

  /** 每个会话一个独立视图（reference 的 retain/release 由它管）。 */
  private views: SidebarSessionViews | undefined;

  /** guide 卡片的钉住状态。 */
  private readonly pins = createGuidePins();

  /** 交给渲染器的 store：`create(key)` 用控制器 adopt 的那一份。 */
  private readonly storeHandle = createSidebarRightStore(() => defaultSeed(this.tabs.face));

  private readonly store = {
    ...this.storeHandle,
    create: (scopeKey?: string) => {
      if (scopeKey === undefined) return this.storeHandle.create();
      return this.row.surfaceOf(scopeKey) ?? this.storeHandle.create(scopeKey);
    },
  };

  private readonly disposers: (() => void)[] = [];

  onInit(): void {
    const views = new SidebarSessionViews(this.sessions);
    this.views = views;
    const t = this.locale.bind(NS);
    const injected = this.injected();
    const tabTypes = {
      getSnapshot: () => this.tabs.entries(),
      subscribe: (listener: () => void) => this.tabs.subscribe(listener),
    };
    this.disposers.push(
      this.row.mounted.subscribe(() => {
        views.select(this.row.mounted.getSnapshot() as never);
      }),
    );
    views.select(this.row.mounted.getSnapshot() as never);
    this.disposers.push(
      this.slots.inject("rightbar", () => {
        const undo: (() => void)[] = [];
        undo.push(
          this.slots.register(
            {
              name: "rightbar",
              children: { "rightbar.session": { kind: "single", scope: "session" } },
              inject: () => ({ hooks: { views: views.source }, mountView: (reference: never) => views.mount(reference) }),
            } as never,
            RightbarRoot as never,
          ),
        );
        undo.push(
          this.slots.register(
            {
              name: "rightbar.session",
              locale: NS,
              store: this.store,
              children: {
                "sidebar.right.pane.tab": { kind: "keyed", scope: "session", inject: { hooks: { tabInfo: tabInfoFactory } } },
                "sidebar.right.pane.tab.title": { kind: "keyed", scope: "session", inject: { hooks: { tabInfo: tabInfoFactory } } },
              },
              inject: (sessionId: string) => ({
                ...injected,
                hooks: {
                  contextMenuTarget: this.contextMenus.active,
                  shortcuts: this.shortcuts.catalog,
                  tabTypes,
                  flash: this.row.flashOf(sessionId as never),
                },
                closeTab: (tabId: never) => {
                  this.row.close(tabId as never);
                },
                keyedHooks: {
                  tabNavigation: (key: string) =>
                    this.row.tabDomain.occurrence(sessionId as never, { id: key as never }).navigation,
                },
                occurrence: (tab: { id: string }) =>
                  this.row.tabDomain.occurrence(sessionId as never, { id: tab.id as never }),
              }),
            } as never,
            RightbarSeat as never,
          ),
        );
        undo.push(
          this.slots.inject("sidebar.right.pane.tab", () => {
            const guideUndo: (() => void)[] = [];
            guideUndo.push(
              this.slots.register(
                {
                  name: "sidebar.right.pane.tab",
                  key: GUIDE_ID,
                  locale: NS,
                  children: {
                    "sidebar.right.tab.guide.actions": { kind: "list", scope: "root" },
                    // guide 的子槽传的 `hookContext` 是 **`useTabInfo` 函数本身**（胶囊只要「点一下开那一页」），
                    // 所以这里要用上游的 `guideTabInfoFactory`（`(_standard, useTabInfo) => useTabInfo`）；
                    // 用通用的 `tabInfoFactory` 会把函数当 `TabHookContext` 对象读 → `useStore is not a function`。
                    "sidebar.right.tab.guide.entry": { kind: "keyed", scope: "session", inject: { hooks: { tabInfo: guideTabInfoFactory } } },
                    "sidebar.right.tab.guide": { kind: "chain", scope: "session", inject: { hooks: { tabInfo: guideTabInfoFactory } } },
                  },
                  inject: (): GuideInjected => ({
                    hooks: {
                      shortcuts: this.shortcuts.catalog,
                      guideEntries: {
                        getSnapshot: () => this.tabs.face.guide(),
                        subscribe: (listener: () => void) => this.tabs.subscribe(listener),
                      },
                      entryPins: this.pins.unpinned,
                      entryActions: {
                        getSnapshot: () => this.slots.entriesOfSlot("sidebar.right.tab.guide.actions").length > 0,
                        subscribe: (listener: () => void) => this.slots.subscribe("sidebar.right.tab.guide.actions", listener),
                      },
                    },
                    setPinned: this.pins.setPinned,
                  }),
                } as never,
                GuideBody as never,
              ),
            );
            guideUndo.push(
              this.slots.register(
                { name: "sidebar.right.pane.tab.title", key: GUIDE_ID, locale: NS } as never,
                GuideTitle as never,
              ),
            );
            return () => {
              for (const dispose of guideUndo.splice(0).reverse()) dispose();
            };
          }),
        );
        undo.push(
          this.slots.inject("conversation.session.header.corner", () =>
            this.slots.register(
              {
                name: "conversation.session.header.corner",
                locale: NS,
                store: this.store,
                inject: () => ({ hooks: { shortcuts: this.shortcuts.catalog } }),
              } as never,
              ExpandButton as never,
            ),
          ),
        );
        return () => {
          for (const dispose of undo.splice(0).reverse()) dispose();
        };
      }),
    );
    // **HMR 容忍，不是允许重复注册**：dev 热更新会替换本模块，但旧实例的 `onDispose` 不会跑，
    // registry（由 `SidebarRightTabsDefault` 持有）里上一次的 guide 还在 → 再注册就抛
    // 「tab kind "guide" is already registered」。生产里 `onInit` 只跑一次，走不到这个分支。
    // 只跳过「同一个 guide id」，其它重复仍然会抛（不掩盖真 bug）。
    if (this.tabs.face.get(GUIDE_ID) === undefined) {
      this.disposers.push(this.tabs.register(guideDefinition(t)));
    }
  }

  /** 座位注入面里与「页面周边」有关的那几个（不含按会话的 hooks / occurrence）。 */
  private injected(): Pick<SidebarRightInjected, "syncPresentation" | "reportAutoFullscreen" | "measureRoom" | "openTab" | "splitPane" | "toggleFullscreen"> {
    return {
      syncPresentation: ({ shown, track }) => {
        if (shown) this.layout.openRightbar(track, false);
        else this.layout.closeRightbar();
      },
      reportAutoFullscreen: () => {},
      measureRoom: () => {},
      openTab: (kind, options) => {
        this.row.openTab(kind, options);
      },
      splitPane: () => {},
      toggleFullscreen: () => {},
    };
  }

  onDispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
    this.views?.dispose();
    this.views = undefined;
  }
}
