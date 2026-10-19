// 配置面的契约：**一份格式化的 JSON 文档**的读写。
//
// 不套上游那套（`SettingsForms` 依赖 cordis loader 的 profile 机制，`SettingsNamespaceView` 里还要
// schema 信封、base/user 分层、密钥脱敏）。本装配只需要「用户改了的配置存在这儿、下次启动读回来」——
// 那就是 `<dataDir>/settings.json` 一个文件，人可读、可手改、diff 得出来。
import { Injectable } from "@morlay/zephyr";

/**
 * 配置文档：命名空间 → 该命名空间的配置树。
 *
 * 键就是上游的命名空间名（`llm-deepseek` / `llm-pi-ai` …），值是可 JSON 化的任意结构。
 */
export type SettingDocument = Record<string, unknown>;

/** 一个命名空间的视图：`value` 是生效值，`revision` 每次写递增（客户端靠它判断视图旧不旧）。 */
export interface SettingNamespaceView {
  readonly ns: string;
  readonly value: unknown;
  /** 用户自己写的那一份（`settings.json` 里的原值）；没有就是缺省。 */
  readonly user?: unknown;
  readonly revision: number;
}

/** 配置面：读文档、按命名空间写。 */
@Injectable()
export abstract class Setting {
  /** 当前的配置文档（返回**副本**，调用方改它不影响落盘）。 */
  abstract snapshot(): SettingDocument;

  /**
   * 深合并一个命名空间：`{a:{b:1}}` 与 `{a:{c:2}}` 合并成 `{a:{b:1,c:2}}`。
   * @param ns - 命名空间。
   * @param patch - 要合并进去的键树。
   * @param expectedRevision - 期望的当前 revision；`undefined` 表示不校验，不匹配抛 `settings/conflict`。
   * @returns 写后的命名空间视图。
   */
  abstract update(ns: string, patch: Record<string, unknown>, expectedRevision?: number): SettingNamespaceView;

  /**
   * 整段覆盖一个命名空间：`{a:{b:1}}` 被 `{a:{c:2}}` 覆盖成 `{a:{c:2}}`。
   * @param ns - 命名空间。
   * @param section - 该命名空间的新值。
   * @param expectedRevision - 同 `update`。
   * @returns 写后的命名空间视图。
   */
  abstract replace(ns: string, section: Record<string, unknown>, expectedRevision?: number): SettingNamespaceView;

}
