// 语言目录契约（上游 `dsh-client-locale` 的 `locale` 服务）：layout、theme、shortcuts 按名字读它。
//
// 这里**不搬上游的类型表**：上游的 `register(ns, …)` 要求 `ns` 是全局 `LocaleNamespaceMap` 的键，
// 各包靠 `declare module` 往里加——那是把字典名做成了全局状态（任何新命名空间都要改别人的类型表）。
// 本仓的契约按**运行时契约**声明：命名空间就是字符串，字典就是「语言 → 键值」。
// 与上游行的兼容由实现保证（`LocaleDefault` 的 face 就是上游实例，签名在运行时一致）。
import { Injectable } from "@morlay/zephyr";

/** 一份字典：语言 → 键值。 */
export type LocaleDict = Record<string, string>;

/** 可注册的字典表：语言 → 字典。 */
export type LocaleDicts = Record<string, LocaleDict>;

/**
 * 当前语言与目录快照（与上游同形）：`active` 是当前语言、`locales` 是可用语言、`revision` 是版本号。
 */
export interface LocaleSnapshot {
  readonly active: string;
  readonly locales: readonly string[];
  readonly revision: number;
}

@Injectable({ name: "locale" })
export abstract class Locale {
  /** 注册一份字典，返回注销函数。 */
  abstract register(ns: string, dicts: LocaleDicts): () => void;

  /** 取某个命名空间的翻译函数。 */
  abstract bind(ns: string): (key: string) => string;

  abstract getSnapshot(): LocaleSnapshot;

  abstract subscribe(listener: () => void): () => void;
}
