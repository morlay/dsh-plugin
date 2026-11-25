// sessionProjectionCache 契约：列表页的投影快照读面（只有读面与写穿，没有构造与生命周期钩子）。
import type { SessionProjectionCache as SessionProjectionCacheService } from "@deepseek-ai/dsh-session-projection-cache";
import { Injectable } from "@morlay/zephyr";
import type { AssertCoveredStrict, AssertTrue } from "@morlay/zephyr-app/client";

/** 能力词汇：检查点的身份（会话 + 水位 + 继承事件数），缓存行按它对齐。 */
export type { CheckpointIdentity } from "@deepseek-ai/dsh-session-projection-cache";

@Injectable({ name: "sessionProjectionCache" })
export abstract class SessionProjectionCache {
  abstract readonly config: SessionProjectionCacheService["config"];

  abstract readonly cachedSnapshot: SessionProjectionCacheService["cachedSnapshot"];

  abstract readonly cachedPredecessorTitle: SessionProjectionCacheService["cachedPredecessorTitle"];

  abstract readonly hydratePrepared: SessionProjectionCacheService["hydratePrepared"];

  abstract readonly write: SessionProjectionCacheService["write"];

  abstract readonly coldSnapshot: SessionProjectionCacheService["coldSnapshot"];
}

/**
 * 覆盖守卫（严格）：上游 `SessionProjectionCacheService` 的每个成员都要有同名、同签名的对应项。
 *
 * 为什么不是 `implements`：上游那份是 cordis `Service` **类**（带私有成员），`implements` 会报
 * TS2720（"Did you mean to extend … and inherit its members as a subclass?"）。签名守卫在这里等价：
 * 漏成员或签名对不上，编译期都会报出成员名（诊断的第二行）。
 */
export type SessionProjectionCacheCovered = AssertTrue<AssertCoveredStrict<SessionProjectionCacheService, SessionProjectionCache>>;
