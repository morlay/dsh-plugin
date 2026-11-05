// sessionProjectionCache 契约：列表页的投影快照读面（只有读面与写穿，没有构造与生命周期钩子）。
import type { SessionProjectionCache as SessionProjectionCacheService } from "@deepseek-ai/dsh-session-projection-cache";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";

/**
 * 契约面：上游 `SessionProjectionCache` 的**全部**公开成员。
 *
 * 成员一个都不能少——上游插件按 `ctx.sessionProjectionCache.<member>` 取用，缺一个那条插件在运行期就是 `undefined`。
 * `config` 是上游服务自己存的已解析配置（公开字段），一并投影，避免消费方按名字去读时拿到 `undefined`。
 */
/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type SessionProjectionCacheCovered = AssertTrue<
  AssertCovered<SessionProjectionCacheService, SessionProjectionCache>
>;

@Injectable()
export abstract class SessionProjectionCache {
  abstract readonly config: SessionProjectionCacheService["config"];

  abstract readonly cachedSnapshot: SessionProjectionCacheService["cachedSnapshot"];

  abstract readonly cachedPredecessorTitle: SessionProjectionCacheService["cachedPredecessorTitle"];

  abstract readonly hydratePrepared: SessionProjectionCacheService["hydratePrepared"];

  abstract readonly write: SessionProjectionCacheService["write"];

  abstract readonly coldSnapshot: SessionProjectionCacheService["coldSnapshot"];
}

