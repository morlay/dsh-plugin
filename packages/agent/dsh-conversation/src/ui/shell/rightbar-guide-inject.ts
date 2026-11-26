// `GuideBody` 要的注入面（`GuideInjected`）：四个 observable + 一个动作。
//
// 抽成纯函数是为了**可测**：端到端夹具还没搭，先证明「五个成员都交出去了」（输入侧）。
import type { HostObservable } from "@deepseek-ai/dsh-client-ui-slots";
import type { ShortcutCatalogEntry } from "@deepseek-ai/dsh-client-shortcuts/client";
import type { SidebarRightGuideBox } from "@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts";

/** 造注入面需要的依赖（装配行给）。 */
export interface GuideInjectDeps {
  /** 快捷键目录（胶囊上的键位提示）。 */
  readonly shortcuts: HostObservable<readonly ShortcutCatalogEntry[]>;
  /** 类型注册表里的 guide 条目。 */
  readonly guideEntries: HostObservable<readonly SidebarRightGuideBox[]>;
  /** 被取消钉住的卡片 id（内存态）。 */
  readonly entryPins: HostObservable<readonly string[]>;
  /** `sidebar.right.tab.guide.actions` 是否有注册项。 */
  readonly entryActions: HostObservable<boolean>;
  /** 钉住 / 取消钉住一张卡片。 */
  readonly setPinned: (id: string, pinned: boolean) => void;
}

/** `GuideBody` 的注入面（形状 = 上游 `GuideInjected`）。 */
export interface GuideInject {
  readonly hooks: {
    readonly shortcuts: HostObservable<readonly ShortcutCatalogEntry[]>;
    readonly guideEntries: HostObservable<readonly SidebarRightGuideBox[]>;
    readonly entryPins: HostObservable<readonly string[]>;
    readonly entryActions: HostObservable<boolean>;
  };
  readonly setPinned: (id: string, pinned: boolean) => void;
}

/**
 * 造 `GuideBody` 的注入面。
 * @param deps - 四个 observable 与一个动作。
 * @returns `{ hooks, setPinned }`（上游 `GuideInjected` 同形）。
 */
export function guideInjectOf(deps: GuideInjectDeps): GuideInject {
  return {
    hooks: {
      shortcuts: deps.shortcuts,
      guideEntries: deps.guideEntries,
      entryPins: deps.entryPins,
      entryActions: deps.entryActions,
    },
    setPinned: deps.setPinned,
  };
}
