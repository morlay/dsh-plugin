// 浏览器侧的「同步配置」：上游 0.2.3 起 client 插件的 `Config` 字段由 Host 同步下来
// （`SyncedConfigRef` = 可 `get()` 的 volatile + 可订阅的快照），构造/apply 时按名读。
//
// 本仓没有那条 Host 同步通道：装配时给每个字段一个**恒为未配置**的引用，上游对"没配"本来就有兜底
// （例如 `stopSequenceMs.get() ?? 默认值`）。字段名必须与上游 `SyncedConfig<C>` 的键一致。
//
// 不引上游 `SyncedConfigRef` 类型：这份桩只提供它与上游共有的三个成员，结构上就够用。

/** 一个同步配置字段的最小实现。 */
export interface FixedSyncedRef<T = undefined> {
  get(): T;
  getSnapshot(): T;
  subscribe(fn: () => void): () => void;
}

/**
 * 造一个同步配置字段的桩。
 * @param value - 该字段的常量值（缺省 `undefined`，即"Host 没同步"）。
 * @returns 该字段的引用。
 */
export function fixedSyncedRef<T = undefined>(value: T = undefined as T): FixedSyncedRef<T> {
  return {
    get: () => value,
    getSnapshot: () => value,
    subscribe: () => () => {},
  };
}

/**
 * 按字段名造一份"都没有配置"的同步配置。
 * @param names - 上游 `Config` 里的 volatile 字段名。
 * @returns 每个字段一个 `fixedSyncedRef(undefined)`。
 */
export function fixedSyncedConfig(
  names: readonly string[],
): Record<string, FixedSyncedRef<unknown>> {
  return Object.fromEntries(names.map((name) => [name, fixedSyncedRef()]));
}
