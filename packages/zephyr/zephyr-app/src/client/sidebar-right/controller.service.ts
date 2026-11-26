// 右栏的**抽象**（框架层）：动作面实现 + 每会话 surface，**不认识 sessions、不注册任何座位**。
//
// 内核用上游工厂造（`SidebarRightTabRegistry` + `createSidebarRightController` + 上游 store）；
// 座位（`rightbar` / `rightbar.session` / 角位按钮）归会话域——它们要绑 `sessions` 的 SessionReference。
//
// 命令要落到某个会话的 surface 上才有意义，所以「在屏会话」的 store 实例由这里懒建并交给控制器 `adopt`；
// 会话域通过契约的第二段（`SidebarRightSurfaces.surfaceOf`）拿到同一份实例。
import type { SidebarRightController } from "@deepseek-ai/dsh-client-ui-sidebar-right/src/client/service.ts";
import { defaultSeed } from "@deepseek-ai/dsh-client-ui-sidebar-right/src/client/contract/seed.ts";
import { createSidebarRightStore } from "@deepseek-ai/dsh-client-ui-sidebar-right/src/client/stores.ts";
import type { PinResource } from "@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-domain.ts";
import {
  createSidebarRightController,
  type SidebarRightHost,
  type SidebarRightSurfaceStore,
} from "@deepseek-ai/dsh-client-ui-sidebar-right/src/client/service.ts";
import { de, en, es, fr, ja, pt, ru, zh } from "@deepseek-ai/dsh-client-ui-sidebar-right/src/client/locales.ts";
import type { SlotScopeAdapter } from "@deepseek-ai/dsh-client-ui-slots";
import { inject, Injectable, type OnDispose, type OnInit } from "@morlay/zephyr";
import { Slots } from "../renderer/slots.contract.ts";
import { ContextMenus } from "../context-menus/context-menus.contract.ts";
import { Locale } from "../locale/locale.contract.ts";
import { Resources } from "../resources/resources.contract.ts";
import { SidebarRight, SidebarRightRow } from "./sidebar-right.contract.ts";
import { SidebarRightTabs } from "./sidebar-right-tabs.contract.ts";

/** 会话 id（类型来自上游控制器自己的读面）。 */
export type SessionKey = Parameters<SidebarRightController["tabsIn"]>[0];

/** 一个 tab 的 id（同上）。 */
type TabKey = Parameters<SidebarRightController["close"]>[0];

/** 本行字典的命名空间（与上游右栏行的 `sidebarRight` 分开：那套文案跟着那个行走）。 */
const NS = "rightbar";

/** 右栏自己的文案（容器与 guide 读；上游组件的文案在 `sidebarRight` 命名空间）。 */
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

/** `ctx.sidebarRight` 的实现：上游控制器的转发面 + 每会话 surface。 */
@Injectable()
export class SidebarRightDefault extends SidebarRightRow implements OnInit, OnDispose {
  /** 类型注册表：与它共享同一个上游注册表实例（控制器的第一个参数）。 */
  private readonly tabs = inject(SidebarRightTabs);

  /** 资源保留：一个 tab 在其 occurrence 存活期间钉住它打开的资源。 */
  private readonly resources = inject(Resources);

  /** 文案。 */
  private readonly locale = inject(Locale);

  /** 槽位注册表：读 session 作用域源，决定「哪个会话在屏」。 */
  private readonly slots = inject(Slots);

  /** session 作用域源的订阅（`mounted` 的唯一来源）。 */
  private adapterSubscription: (() => void) | undefined;

  /** 右键菜单：右栏 tab 的关 / 关其它 / 关右侧（同层能力，框架链默认就有）。 */
  private readonly contextMenus = inject(ContextMenus);

  /** 控制器工厂：`onInit` 才能建（它要往上游注册表登记、并持有会话 map）。 */
  private factory: ReturnType<typeof createSidebarRightController> | undefined;

  /** 每个会话的 store 句柄（上游那份：布局、历史、动作都在它上面）。 */
  private readonly store = createSidebarRightStore(() => defaultSeed(this.tabs.face));

  /** 已建出来的会话 surface（`adopt` 过的实例）。 */
  private readonly surfaces = new Map<string, SidebarRightSurfaceStore>();

  /** 每个会话的 adopt 撤销函数。 */
  private readonly releases = new Map<string, () => void>();

  /** 字典与菜单的撤销函数。 */
  private readonly disposers: (() => void)[] = [];

  /** 建控制器、注册字典与右键菜单（**不注册任何座位**：座位归会话域）。 */
  onInit(): void {
    this.factory = createSidebarRightController(this.tabs.face, this.pin, this.host);
    // `mounted` 的唯一来源：session 作用域源的当前绑定（上游由座位/控制器自己驱动，我们由这里驱动）。
    this.bindOnScreen();
    this.disposers.push(this.locale.register(NS, DICTS));
    // 上游那几个座位组件（`ExpandButton` / guide）读的是 `sidebarRight` 命名空间：整份搬过来。
    this.disposers.push(this.locale.register("sidebarRight", { zh, en, ja, es, fr, de, ru, pt }));
    this.registerContextMenu();
  }

  /**
   * 把「哪个会话在屏」报给控制器（`mounted` 从这里来）。
   *
   * 这是 `mounted` 的**唯一来源**：`3+4+2` 删掉旧视图源时它被一起删了，`ui-subagent` 的拖拽判空因此恒走空分支。
   * session 作用域源可能晚于本行就位，所以装配期先试一次、之后跟着它变化。
   */
  private bindOnScreen(): void {
    const adapter = this.slots.scope("session") as SlotScopeAdapter | undefined;
    if (adapter === undefined) return;
    const sync = (): void => {
      this.factory?.show(adapter.current.getSnapshot().key as SessionKey | undefined);
    };
    this.adapterSubscription = adapter.current.subscribe(sync);
    sync();
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
   * 某个会话的 surface：第一次要就建出来、交给控制器 adopt（命令才有落点）。
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
   * 记下一个会话的 surface 并交给控制器 adopt（幂等）。
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

  /** 控制器（测试与装配排查用）。 */
  get controller(): SidebarRightController {
    return this.core;
  }

  get mounted(): SidebarRight["mounted"] {
    return this.core.mounted;
  }

  readonly openResource: SidebarRight["openResource"] = (address, options) => {
    this.core.openResource(address, options);
  };

  readonly openContent: SidebarRight["openContent"] = (kind, content, options) => {
    this.core.openContent(kind, content, options);
  };

  readonly openTab: SidebarRight["openTab"] = (kind, options) => {
    this.core.openTab(kind, options);
  };

  readonly close: SidebarRight["close"] = (tabId) => {
    this.core.close(tabId);
  };

  readonly hide: SidebarRight["hide"] = (tabId) => {
    this.core.hide(tabId);
  };

  readonly active: SidebarRight["active"] = () => this.core.active();

  readonly isExpanded: SidebarRight["isExpanded"] = () => this.core.isExpanded();

  readonly toggleExpanded: SidebarRight["toggleExpanded"] = () => {
    this.core.toggleExpanded();
  };

  readonly focus: SidebarRight["focus"] = (tabId) => {
    this.core.focus(tabId);
  };

  get tabDomain(): SidebarRightController["tabDomain"] {
    return this.core.tabDomain;
  }

  get openTabs(): SidebarRightController["openTabs"] {
    return this.core.openTabs;
  }

  get tabsIn(): SidebarRightController["tabsIn"] {
    return this.core.tabsIn.bind(this.core);
  }

  get closeIn(): SidebarRightController["closeIn"] {
    return this.core.closeIn.bind(this.core);
  }

  get openTabIn(): SidebarRightController["openTabIn"] {
    return this.core.openTabIn.bind(this.core);
  }

  get openResourceIn(): SidebarRightController["openResourceIn"] {
    return this.core.openResourceIn.bind(this.core);
  }

  get commandTarget(): SidebarRightController["commandTarget"] {
    return this.core.commandTarget.bind(this.core);
  }

  get openTabFromTarget(): SidebarRightController["openTabFromTarget"] {
    return this.core.openTabFromTarget.bind(this.core);
  }

  get registerCloseHandler(): SidebarRightController["registerCloseHandler"] {
    return this.core.registerCloseHandler.bind(this.core);
  }

  get menuTabs(): SidebarRightController["menuTabs"] {
    return this.core.menuTabs.bind(this.core);
  }

  get flashOf(): SidebarRightController["flashOf"] {
    return this.core.flashOf.bind(this.core);
  }

  /** 卸载：撤菜单与字典，撤销 adopt，让控制器忘掉会话。 */
  onDispose(): void {
    this.adapterSubscription?.();
    this.adapterSubscription = undefined;
    this.factory?.show(undefined);
    for (const dispose of this.disposers.splice(0)) dispose();
    for (const release of this.releases.values()) release();
    this.releases.clear();
    for (const sessionId of this.surfaces.keys()) this.factory?.forget(sessionId as SessionKey);
    this.surfaces.clear();
  }
}
