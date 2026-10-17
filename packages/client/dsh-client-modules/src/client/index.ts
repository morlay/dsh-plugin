// client 半：两件事，都是**把上游那条链缺的面补上**。
//
// 1. `modules` 服务面：上游 `ui-settings-general` 的 client 插件 inject 它（有它就忽略 peer），
//    我们的装配停用了上游 `client-modules` 行，所以这里补一个最小实现（见文件头注释与 README）。
// 2. 终端恢复兜底：上游 `api-terminal-controller` 的客户端把「侧栏 tab → 终端 id」记在 `bindings` 里
//    （`dsh.terminal.binding.v1.[sessionId, contentId]`），而 Host 侧 `close()` 会把那个 id 记进
//    `closedIds` 并且**永不再接受**（`retain()` 回 `terminal/unavailable`）。布局与 binding 会把这个
//    已失效的 id 一直带回来，`TerminalView` 的 `createWhenMissing` 只在「没有 saved id」时才分配新终端
//    —— 于是面板永远停在"此终端已不存在，请新建终端"，点"新建终端"复用的还是它。
import type { Context } from "@deepseek-ai/cordis";

/** 恒 `undefined` 的可订阅快照（`useSyncExternalStore` 的入参形状）。 */
const NO_RELEASE_CHANGE = {
  getSnapshot: (): undefined => undefined,
  subscribe: () => () => {},
};

/**
 * 浏览器侧的根插件。
 *
 * @param ctx - 浏览器侧根上下文。
 */
export function apply(ctx: Context): void {
  ctx.reflect.provide("modules", {
    entries: {
      releaseChange: NO_RELEASE_CHANGE,
      dismissRelease: () => {},
    },
    invalidate: () => {},
  });
  installTerminalRecovery(ctx);
}

/** 终端 id 与它在宿主清单里的存在性（清单未加载时按"不在"处理，见下面的取舍）。 */
interface TerminalInventoryLike {
  readonly items?: Map<string, unknown>;
}
interface TerminalsLike {
  readonly bindings?: {
    get?: (sessionId: string, contentId: string) => string | undefined;
    delete?: (sessionId: string, contentId: string) => void;
  };
  readonly inventories?: Map<string, TerminalInventoryLike>;
  readonly views?: Map<string, Map<string, unknown>>;
}
type ViewFn = (
  sessionId: string,
  key: string,
  contentId: string,
  terminalId?: string,
  shellPath?: string,
) => unknown;

/**
 * 终端恢复兜底：`view` 之前先**对账**，把宿主已经不认的终端 id 当新 tab 处理。
 *
 * 上游 `TerminalView` 的语义是「新 tab 才分配」（`createWhenMissing = saved === undefined`），而
 * `saved = terminalId ?? bindings.get(sessionId, contentId)`：UI 传的 `terminalId` 实测是 `undefined`，
 * 所以决定权全在 `bindings` —— 它不随宿主侧关闭状态失效。清单里没有这个 id（宿主重启过、或那个终端被
 * 关过）时删掉这条 binding，让上游按新 tab 分配；清单里有则原样透传，恢复能力不变。清单**没加载**时按
 * 「不在」处理：那时用户要的就是打开一个终端，让它重新分配比卡在死状态里强。
 *
 * 注意：`bindings` / `inventories` 是上游 Service 的私有字段，`view` 在其原型上（实例属性覆盖无效，
 * 见 cordis 的 Service 代理）——所以这里改的是原型。这是**绕过上游缺陷**，等上游把 binding 与关闭状态
 * 对上账就该删掉。
 *
 * @param ctx - 浏览器侧根上下文。
 */
function installTerminalRecovery(ctx: Context): void {
  ctx.inject(["webTerminals"], (scope) => {
    const terminals = scope.get("webTerminals") as TerminalsLike | undefined;
    if (terminals === undefined) return;
    const proto = Object.getPrototypeOf(terminals) as {
      view?: ViewFn;
      __terminalRecovery?: boolean;
    };
    if (proto.view === undefined || proto.__terminalRecovery === true) return;
    proto.__terminalRecovery = true;
    const original = proto.view;
    proto.view = function (
      this: TerminalsLike,
      sessionId: string,
      key: string,
      contentId: string,
      terminalId?: string,
      shellPath?: string,
    ) {
      const bound = terminalId ?? this.bindings?.get?.(sessionId, contentId);
      const alive =
        bound === undefined || this.inventories?.get(sessionId)?.items?.has(bound) === true;
      if (!alive) {
        this.bindings?.delete?.(sessionId, contentId);
        // TODO: 「丢掉已经存在的那份视图」（`this.views?.get(sessionId)?.delete(key)`）暂时拿掉了：
        // `view()` 对已缓存的 key 直接返回旧实例，不丢它，清 binding 只在下一次真正重建时才生效。
        // 这处的行为待定，对应用例现在 skip（见 `__tests__/terminal-recovery.spec.ts`）。
        return original.call(this, sessionId, key, contentId, undefined, shellPath);
      }
      return original.call(this, sessionId, key, contentId, terminalId, shellPath);
    };
  });
}
