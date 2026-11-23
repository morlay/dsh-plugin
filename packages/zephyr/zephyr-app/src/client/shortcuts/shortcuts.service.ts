import ShortcutsPlugin from "@deepseek-ai/dsh-client-shortcuts/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Locale } from "../locale/locale.contract.ts";
import { Shortcuts } from "./shortcuts.contract.ts";

/**
 * 一个"同步配置字段"的最小实现：上游 0.2.3 起 `shortcuts` 的 `Config` 字段由 Host 同步下来
 * （`SyncedConfigRef` = 可 `get()` 的 volatile + 可订阅的快照）。没有 Host 同步通道的装配（headless 与测试）
 * 给一个恒为 `undefined` 的引用——上游 `stopSequenceMs` 的读口本来就把 `undefined` 当"没配"。
 * @param value - 该字段的常量值。
 * @returns 可作为 `SyncedConfigRef` 用的引用。
 */
function fixedSyncedRef<T>(value: T): {
  get(): T;
  getSnapshot(): T;
  subscribe(fn: () => void): () => void;
} {
  return {
    get: () => value,
    getSnapshot: () => value,
    subscribe: () => () => {},
  };
}

@Injectable()
export class ShortcutsDefault extends fromCordis(Shortcuts, ShortcutsPlugin) {
  private readonly locale = inject(Locale);

  async onInit(ctx: Context): Promise<void> {
    // 上游是 `Service` 子类：构造的第二参就是它的 config（`fromCordis` 对 Service 分支不走 deps）。
    // 0.2.3 起这个 config 是 Host 同步下来的 `SyncedConfig`，构造里读 `config.stopSequenceMs`。
    await this.mount(ctx, { stopSequenceMs: fixedSyncedRef(undefined) }, { locale: this.locale });
  }
}
