/**
 * 测试用的 describe 读面替身：可推动命名空间清单变化，形状与上游 mirror 的读面一致。
 */

import type { SettingsNamespaceView } from "@deepseek-ai/dsh-api-remotes/client";
import type { SettingsDescribeFace } from "@deepseek-ai/dsh-client-ui-settings/client";

/** 一个可以推动变更的 describe 读面。 */
export interface FakeDescribe extends SettingsDescribeFace {
  /** 换掉命名空间清单并通知订阅者。 */
  publish(namespaces: readonly SettingsNamespaceView[]): void;
}

/**
 * @param initial - 初始命名空间清单。
 * @returns 可读可推的 describe 替身。
 */
export function fakeDescribe(initial: readonly SettingsNamespaceView[] = []): FakeDescribe {
  const listeners = new Set<() => void>();
  let namespaces = initial;
  return {
    getSnapshot: () => ({
      status: "ready" as const,
      view: { namespaces, writable: true, hasDocument: false },
      error: null,
    }),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    ensure: () => Promise.resolve(),
    // 写回答折进读数：同一命名空间替换，未出现过的追加（与上游 mirror 同一语义）。
    acceptView: (view) => {
      namespaces = namespaces.some((row) => row.ns === view.ns)
        ? namespaces.map((row) => (row.ns === view.ns ? view : row))
        : [...namespaces, view];
    },
    publish: (next: readonly SettingsNamespaceView[]) => {
      namespaces = next;
      for (const listener of listeners) listener();
    },
  };
}
