// 右栏的**动作面实现 + 座位**：内核用上游的工厂造，成员全部转发；座位用本仓的组件。
//
// 上游右栏包的 `apply` 里那两行就是全部内核：`new SidebarRightTabRegistry(ctx)` 与
// `createSidebarRightController(tabs, pin, host)`。我们不装那个插件（它会把座位、guide 页与右键菜单
// 一并塞进来），只调工厂——于是 `openResource` / `tabDomain` / `openTabs` / `commandTarget` /
// `openTabFromTarget` 都是上游真语义，而不是我们重写的近似。
//
// 命令要落到某个会话的 surface 上才有意义，所以「在屏会话」的 store 实例由这里懒建并交给控制器
// `adopt`：容器渲染到哪个会话，就把哪个会话的 surface 建出来。
//
// 座位只有两层：`rightbar`（帧的右列，root）直接声明上游的两个 keyed 槽位名；上游行硬编码注册在
// 这两个名字上，所以它们的正文与标题自动进来。
import type { SlotScopeAdapter, StandardSourceBinding } from "@deepseek-ai/dsh-client-ui-slots";
import type { SidebarRightController } from "@deepseek-ai/dsh-client-ui-sidebar-right/src/client/service.ts";
import { defaultSeed } from "@deepseek-ai/dsh-client-ui-sidebar-right/src/client/contract/seed.ts";
import { createSidebarRightStore, type SidebarRightState } from "@deepseek-ai/dsh-client-ui-sidebar-right/src/client/stores.ts";
import type { PinResource } from "@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-domain.ts";
import {
  createSidebarRightController,
  type SidebarRightHost,
  type SidebarRightSurfaceStore,
} from "@deepseek-ai/dsh-client-ui-sidebar-right/src/client/service.ts";
import { inject, Injectable, type OnDispose, type OnInit } from "@morlay/zephyr";
import { de, en, es, fr, ja, pt, ru, zh } from "@deepseek-ai/dsh-client-ui-sidebar-right/src/client/locales.ts";
import { ExpandButton } from "@deepseek-ai/dsh-client-ui-sidebar-right/src/client/shell/ExpandButton.tsx";
import { Rightbar, type RightbarView } from "@morlay/zephyr-ui";
import { Shortcuts } from "../shortcuts/shortcuts.contract.ts";
import { ContextMenus } from "../context-menus/context-menus.contract.ts";
import { Layout } from "../layout/layout.contract.ts";
import { Locale } from "../locale/locale.contract.ts";
import { Resources } from "../resources/resources.contract.ts";
import { Slots } from "../renderer/slots.contract.ts";
import { SidebarRight, SidebarRightRow } from "./sidebar-right.contract.ts";
import { SidebarRightTabs } from "./sidebar-right-tabs.contract.ts";

/** 会话 id（类型来自上游控制器自己的读面，不再引第二处 branded 类型）。 */
export type SessionKey = Parameters<SidebarRightController["tabsIn"]>[0];

/** 一个 tab 的 id（同上）。 */
type TabKey = Parameters<SidebarRightController["close"]>[0];

/** 本行字典的命名空间（与上游右栏行的 `sidebarRight` 分开：那套文案跟着那个行走）。 */
const NS = "rightbar";

/** 右栏自己的四条文案 + 入口名。 */
const DICTS = {
  zh: {
    panel: "右侧面板",
    close: "关闭标签",
    empty: "没有打开的标签",
    unavailable: "这个标签的正文还没有注册",
    expand: "展开右侧面板",
    closeOthers: "关闭其它标签",
    closeRight: "关闭右侧标签",
    "guide.title": "右侧面板",
    "guide.empty": "还没有可用的标签：从左栏打开文件、终端或浏览器",
  },
  en: {
    panel: "Right panel",
    close: "Close tab",
    empty: "No open tabs",
    unavailable: "No body is registered for this tab",
    expand: "Expand right panel",
    closeOthers: "Close other tabs",
    closeRight: "Close tabs to the right",
    "guide.title": "Right panel",
    "guide.empty": "No tabs yet — open a file, terminal, or browser from the left column",
  },
};

/** `ctx.sidebarRight` 的实现：上游控制器的转发面 + 每会话 surface + 三个座位。 */
@Injectable()
export class SidebarRightDefault extends SidebarRightRow implements OnInit, OnDispose {
  /** 类型注册表：与它共享同一个上游注册表实例（控制器的第一个参数）。 */
  private readonly tabs = inject(SidebarRightTabs);

  /** 资源保留：一个 tab 在其 occurrence 存活期间钉住它打开的资源。 */
  private readonly resources = inject(Resources);

  /** 帧：展开/收起要报给它（列宽与拖拽把手都归它）。 */
  private readonly layout = inject(Layout);

  /** 槽位注册表：两个座位挂在它上面。 */
  private readonly slots = inject(Slots);

  /** 文案。 */
  private readonly locale = inject(Locale);

  /** 右键菜单：右栏 tab 的关 / 关其它 / 关右侧（同层能力，框架链默认就有）。 */
  private readonly contextMenus = inject(ContextMenus);

  /** 快捷键目录：角位展开按钮的 tooltip 与 aria 读它。 */
  private readonly shortcuts = inject(Shortcuts);

  /** 控制器工厂：`onInit` 才能建（它要往上游注册表登记、并持有会话 map）。 */
  private factory: ReturnType<typeof createSidebarRightController> | undefined;

  /** 每个会话的 store 句柄（上游那份：布局、历史、动作都在它上面）。 */
  private readonly store = createSidebarRightStore(() => defaultSeed(this.tabs.face));

  /**
   * 交给渲染器的 store 句柄：按 session 作用域 `create` 时顺手 adopt。
   *
   * 上游 apply 也是这么包一层；不 adopt 的话，座位里的 `actions`（展开/关闭）写进的 store
   * 不是控制器认的那一份，命令就没有落点。
   */
  private readonly rightbarStore = {
    ...this.store,
    create: (scopeKey?: string) => {
      const instance = this.store.create(scopeKey);
      if (scopeKey !== undefined) this.attach(scopeKey, instance as SidebarRightSurfaceStore);
      return instance;
    },
  };

  /** 已建出来的会话 surface（`adopt` 过的实例）。 */
  private readonly surfaces = new Map<string, SidebarRightSurfaceStore>();

  /** 每个会话的 adopt 撤销函数。 */
  private readonly releases = new Map<string, () => void>();

  /** 右栏视图的订阅者（`useRightbar` 的源）。 */
  private readonly listeners = new Set<() => void>();

  /** 右栏视图快照（引用稳定：值真的变了才换）。 */
  private snapshot: RightbarView = { expanded: false, binding: undefined, tabs: [], activeTabId: undefined };

  /** session 作用域源的订阅（第一次有人订阅视图时才接）。 */
  private adapterSubscription: (() => void) | undefined;

  /** 当前会话 surface 的订阅。 */
  private surfaceSubscription: { readonly sessionId: string; readonly unsubscribe: () => void } | undefined;

  /** 已经接上的静态源（注册表变化）。 */
  private tabsSubscription: (() => void) | undefined;

  /** 座位与菜单的撤销函数。 */
  private readonly disposers: (() => void)[] = [];

  /** 视图源（框架把 `hooks.rightbar` 绑成 `useRightbar`）。 */
  private readonly state = {
    getSnapshot: (): RightbarView => this.snapshot,
    subscribe: (listener: () => void): (() => void) => {
      this.listeners.add(listener);
      this.bindSources();
      return () => {
        this.listeners.delete(listener);
      };
    },
  };

  /**
   * 建控制器、注册座位与菜单。
   */
  onInit(): void {
    this.factory = createSidebarRightController(this.tabs.face, this.pin, this.host);
    this.disposers.push(this.locale.register(NS, DICTS));
    // 上游那几个座位组件（`ExpandButton` / guide）读的是 `sidebarRight` 命名空间：整份搬过来。
    this.disposers.push(this.locale.register("sidebarRight", { zh, en, ja, es, fr, de, ru, pt }));
    this.registerSeats();
    this.registerContextMenu();
  }

  /** 上游控制器（`onInit` 之前读到就是装配顺序错误）。 */
  private get core(): SidebarRightController {
    if (this.factory === undefined) throw new Error("sidebarRight 未初始化：装配顺序错误（onInit 之前被调用）");
    return this.factory.controller;
  }

  /** 文案函数。 */
  private get t(): (key: string) => string {
    return this.locale.bind(NS);
  }

  /** 资源保留的实现：交给本仓的 `resources` 面。 */
  private readonly pin: PinResource = (address, signal) => {
    this.resources.pin(address, signal);
  };

  /**
   * 页面周边交给控制器的三件事：不自动全屏、聚焦保持交给浏览器默认。
   *
   * 上游用 `openWithPaneFocus` / `closeWithPaneFocus` 做 DOM 焦点连续性；我们这套座位不拆 pane，
   * 换页本来就把焦点交给新内容，所以直接执行操作。
   */
  private readonly host: SidebarRightHost = {
    autoFullscreen: () => false,
    openWithFocus: (_sessionId, open) => {
      open();
    },
    closeWithFocus: (_sessionId, _paneId, close) => {
      close();
    },
  };

  /**
   * 某个会话的 surface：第一次要就建出来、交给控制器 adopt（命令才有落点），并报告为在屏会话。
   * @param sessionId - 会话 id。
   * @returns 该会话的 store 实例（同一会话永远是同一个）。
   */
  surfaceOf(sessionId: string): SidebarRightSurfaceStore | undefined {
    const existing = this.surfaces.get(sessionId);
    if (existing !== undefined) return existing;
    const instance = this.store.create(sessionId) as SidebarRightSurfaceStore;
    this.attach(sessionId, instance);
    return instance;
  }

  /**
   * 记下一个会话的 surface 并交给控制器 adopt（幂等：渲染器与视图源可能都来建一次）。
   * @param sessionId - 会话 id。
   * @param instance - 该会话的 store 实例。
   */
  private attach(sessionId: string, instance: SidebarRightSurfaceStore): void {
    if (this.surfaces.has(sessionId)) return;
    this.surfaces.set(sessionId, instance);
    this.releases.set(sessionId, this.adopt(sessionId, instance));
  }

  /**
   * 把一个会话的 store 交给控制器（之后它的命令都落在这份 surface 上）。
   * @param sessionId - 会话 id。
   * @param instance - 该会话的 store 实例。
   * @returns 撤销函数。
   */
  private adopt(sessionId: string, instance: SidebarRightSurfaceStore): () => void {
    const release = this.factory?.adopt(sessionId as SessionKey, instance) ?? (() => {});
    this.factory?.show(sessionId as SessionKey);
    return release;
  }

  /** 接上视图的三条源（幂等：会话源可能晚于首次渲染就位）。 */
  private bindSources(): void {
    this.tabsSubscription ??= this.tabs.face.subscribe(() => {
      this.refresh();
    });
    const adapter = this.sessionAdapter();
    if (adapter !== undefined && this.adapterSubscription === undefined) {
      this.adapterSubscription = adapter.current.subscribe(() => {
        this.refresh();
      });
    }
    this.refresh();
  }

  /** 当前会话的 scope 源（session 域的行装的适配器）。 */
  private sessionAdapter(): SlotScopeAdapter | undefined {
    return this.slots.scope("session") as SlotScopeAdapter | undefined;
  }

  /** 重算视图快照（变了才通知）。 */
  private refresh(): void {
    this.bindAdapterIfReady();
    const binding = this.sessionAdapter()?.current.getSnapshot();
    const sessionId = binding?.key;
    if (sessionId !== undefined) {
      const surface = this.surfaceOf(sessionId);
      if (surface !== undefined && this.surfaceSubscription?.sessionId !== sessionId) {
        this.surfaceSubscription?.unsubscribe();
        this.surfaceSubscription = {
          sessionId,
          unsubscribe: surface.subscribe(() => {
            this.refresh();
          }),
        };
      }
    }
    const next = this.viewOf(binding, sessionId);
    if (sameView(this.snapshot, next)) return;
    this.snapshot = next;
    for (const listener of Array.from(this.listeners)) listener();
  }

  /** 会话源就位后再接一次订阅（它可能晚于首次渲染）。 */
  private bindAdapterIfReady(): void {
    const adapter = this.sessionAdapter();
    if (adapter === undefined || this.adapterSubscription !== undefined) return;
    this.adapterSubscription = adapter.current.subscribe(() => {
      this.refresh();
    });
  }

  /**
   * 由一份 binding 算出视图快照。
   * @param binding - 当前会话的 scope 绑定。
   * @param sessionId - 当前会话 id。
   * @returns 视图快照。
   */
  private viewOf(binding: StandardSourceBinding | undefined, sessionId: string | undefined): RightbarView {
    const layout = this.layoutOf(sessionId);
    const tabs = layout === undefined
      ? []
      : Object.values(layout.tabs).map(tab => ({
          id: tab.id,
          title: tab.title,
          typeId: this.tabs.face.get(tab.kind)?.id,
        }));
    return {
      expanded: layout?.expanded ?? false,
      binding,
      tabs,
      activeTabId: sessionId === undefined ? undefined : this.core.active()?.id,
    };
  }

  /**
   * 某会话的布局（store 里那份）。
   * @param sessionId - 会话 id。
   * @returns 布局；没有会话时 `undefined`。
   */
  private layoutOf(sessionId: string | undefined): SidebarRightState["bySession"][string]["layout"] | undefined {
    if (sessionId === undefined) return undefined;
    return this.surfaces.get(sessionId)?.getSnapshot().bySession[sessionId]?.layout;
  }

  /** 注册两个座位：右列容器与会话头角位的展开按钮。 */
  private registerSeats(): void {
    this.disposers.push(
      this.slots.inject("rightbar", () =>
        this.slots.register(
          {
            name: "rightbar",
            children: {
              "sidebar.right.pane.tab": { kind: "keyed", scope: "session" },
              "sidebar.right.pane.tab.title": { kind: "keyed", scope: "session" },
            },
            inject: () => this.rightbarProps(),
          } as never,
          Rightbar as never,
        ),
      ),
    );
    this.disposers.push(
      this.slots.inject("conversation.session.header.corner", () =>
        this.slots.register(
          {
            name: "conversation.session.header.corner",
            locale: "sidebarRight",
            // store 按 session 作用域建：按钮读同一份 surface 的 `expanded`，点它就是 `actions.setExpanded`。
            store: this.rightbarStore,
            inject: () => ({ hooks: { shortcuts: this.shortcuts.catalog } }),
          } as never,
          ExpandButton as never,
        ),
      ),
    );
  }

  /** 容器座位的注入面（渲染器把 `hooks.rightbar` 绑成 `useRightbar`）。 */
  private rightbarProps(): object {
    return {
      hooks: { rightbar: this.state },
      labels: {
        title: this.t("panel"),
        close: this.t("close"),
        empty: this.t("empty"),
        unavailable: this.t("unavailable"),
      },
      select: (tabId: string) => {
        this.core.focus(tabId as TabKey);
      },
      close: (tabId: string) => {
        this.core.close(tabId as TabKey);
      },
      syncPresentation: (track: boolean) => {
        if (track) this.layout.openRightbar(true, false);
        else this.layout.closeRightbar();
      },
    };
  }

  /** 注册右栏 tab 的右键菜单：关 / 关其它 / 关右侧（「右侧」按记录顺序算）。 */
  private registerContextMenu(): void {
    this.disposers.push(
      this.contextMenus.register({
        id: "sidebar.close",
        target: "tab",
        order: 100,
        resolve: ({ sessionId, paneId, tab }) => {
          const scope = this.core.menuTabs(sessionId, paneId, tab.id);
          if (!scope.close && scope.all.length === 0) return [];
          const closeMany = (ids: readonly TabKey[]): void => {
            for (const id of ids) {
              // 每一项都在按下时重算：菜单开着的时候别的 tab 可能已经关了。
              if (this.core.menuTabs(sessionId, paneId, tab.id).all.includes(id)) this.core.closeIn(sessionId, id);
            }
          };
          return [
            {
              id: "close",
              label: this.t("close"),
              disabled: !scope.close,
              run: () => {
                if (this.core.menuTabs(sessionId, paneId, tab.id).close) this.core.closeIn(sessionId, tab.id);
              },
            },
            {
              id: "others",
              label: this.t("closeOthers"),
              disabled: scope.all.length === 0,
              run: () => {
                closeMany(scope.all);
              },
            },
            ...(scope.right.length === 0
              ? []
              : [
                  {
                    id: "right",
                    label: this.t("closeRight"),
                    run: () => {
                      closeMany(scope.right);
                    },
                  },
                ]),
          ];
        },
      }),
    );
  }
  /** 控制器（座位行以外的读面：测试与装配排查用）。 */
  get controller(): SidebarRightController {
    return this.core;
  }

  /** 在屏会话（上游语义：主列显示会话时的那个选中会话）。 */
  get mounted(): SidebarRight["mounted"] {
    return this.core.mounted;
  }

  /** 打开一个资源（上游语义：认领、放置、露出右栏、记录导航）。 */
  readonly openResource: SidebarRight["openResource"] = (address, options) => {
    this.core.openResource(address, options);
  };

  /** 按类型打开临时内容。 */
  readonly openContent: SidebarRight["openContent"] = (kind, content, options) => {
    this.core.openContent(kind, content, options);
  };

  /** 按类型打开一页。 */
  readonly openTab: SidebarRight["openTab"] = (kind, options) => {
    this.core.openTab(kind, options);
  };

  /** 关掉在屏会话的一个 tab。 */
  readonly close: SidebarRight["close"] = (tabId) => {
    this.core.close(tabId);
  };

  /** 藏一个 tab。 */
  readonly hide: SidebarRight["hide"] = (tabId) => {
    this.core.hide(tabId);
  };

  /** 当前活动 tab。 */
  readonly active: SidebarRight["active"] = () => this.core.active();

  /** 面板是否展开。 */
  readonly isExpanded: SidebarRight["isExpanded"] = () => this.core.isExpanded();

  /** 折叠 / 展开。 */
  readonly toggleExpanded: SidebarRight["toggleExpanded"] = () => {
    this.core.toggleExpanded();
  };

  /** 聚焦一个 tab。 */
  readonly focus: SidebarRight["focus"] = (tabId) => {
    this.core.focus(tabId);
  };

  // —— 契约之外、上游行按名字用到的成员：原样转发（`ctx.sidebarRight` 的实际类型是上游控制器）——

  /** tab 域：每个 tab 记录的导航与生命周期。 */
  get tabDomain(): SidebarRightController["tabDomain"] {
    return this.core.tabDomain;
  }

  /** 跨会话的打开 tab 清单（终端与浏览器的保活读它）。 */
  get openTabs(): SidebarRightController["openTabs"] {
    return this.core.openTabs;
  }

  /** 一个会话里打开的 tab 记录。 */
  get tabsIn(): SidebarRightController["tabsIn"] {
    return this.core.tabsIn.bind(this.core);
  }

  /** 按会话关一个 tab。 */
  get closeIn(): SidebarRightController["closeIn"] {
    return this.core.closeIn.bind(this.core);
  }

  /** 按会话打开一页。 */
  get openTabIn(): SidebarRightController["openTabIn"] {
    return this.core.openTabIn.bind(this.core);
  }

  /** 按会话打开一个资源。 */
  get openResourceIn(): SidebarRightController["openResourceIn"] {
    return this.core.openResourceIn.bind(this.core);
  }

  /** 快捷键用：把 DOM 里的元素解析成右栏目标。 */
  get commandTarget(): SidebarRightController["commandTarget"] {
    return this.core.commandTarget.bind(this.core);
  }

  /** 快捷键用：在目标旁边按类型开一页。 */
  get openTabFromTarget(): SidebarRightController["openTabFromTarget"] {
    return this.core.openTabFromTarget.bind(this.core);
  }

  /** 某 kind 的关闭钩子（终端用它收掉进程）。 */
  get registerCloseHandler(): SidebarRightController["registerCloseHandler"] {
    return this.core.registerCloseHandler.bind(this.core);
  }

  /** 右键菜单用：一个 tab 的「全部 / 右侧 / 能否关」。 */
  get menuTabs(): SidebarRightController["menuTabs"] {
    return this.core.menuTabs.bind(this.core);
  }

  /** 会话的发光源（上游座位的 `hooks.flash` 读它）。 */
  get flashOf(): SidebarRightController["flashOf"] {
    return this.core.flashOf.bind(this.core);
  }

  /** 卸载：撤座位与订阅，撤销每个会话的 adopt，并让控制器忘掉它们。 */
  onDispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
    this.tabsSubscription?.();
    this.tabsSubscription = undefined;
    this.adapterSubscription?.();
    this.adapterSubscription = undefined;
    this.surfaceSubscription?.unsubscribe();
    this.surfaceSubscription = undefined;
    for (const release of this.releases.values()) release();
    this.releases.clear();
    for (const sessionId of this.surfaces.keys()) this.factory?.forget(sessionId as SessionKey);
    this.surfaces.clear();
    this.listeners.clear();
  }
}

/**
 * 两份视图快照是否等价（tab 列表按内容比，其余按值比）。
 * @param left - 旧快照。
 * @param right - 新快照。
 * @returns 等价为 `true`。
 */
function sameView(left: RightbarView, right: RightbarView): boolean {
  if (left.expanded !== right.expanded) return false;
  if (left.binding !== right.binding) return false;
  if (left.activeTabId !== right.activeTabId) return false;
  if (left.tabs.length !== right.tabs.length) return false;
  return left.tabs.every((tab, index) => {
    const other = right.tabs[index];
    return other !== undefined && tab.id === other.id && tab.title === other.title && tab.typeId === other.typeId;
  });
}