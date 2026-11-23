// 分支行：把持久化后端的行级端口接到 SessionBranch 契约上，并负责 live 会话的内存 log 失效。
//
// 前缀读取与 fork / rewind 在 provider / fork / rewind 里；这里只有契约行与装配。
//
// 投影注册表按**契约令牌**取（`inject.optional(SessionProjectionStore)`，读注入值本身是延迟的：
// 装配顺序由清单的拓扑排序保证）。其余三条**故意**仍按服务名在调用时现读，理由逐条写在 `lookup` 上：
// 它们要么读上游的 private 字段、要么读本包扩展的方法、要么晚挂载且令牌与上游契约不匹配。
import {
  SessionLogOffset,
  type Session,
  type SessionEvent,
  type SessionHeader,
  type SessionId,
} from "@morlay/dsh-session/contract";
import type { SessionPersistenceSnapshot } from "@morlay/dsh-session-persistence/contract";
import {
  type BranchAnchorMode,
  type BranchBoundary,
  type ForkFromOptions,
} from "@morlay/session-rdb/endpoint";
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import { SessionProjectionStore, SessionStore } from "@morlay/dsh-session";
import { inject, Injectable, Logger, type Context, type OnInit } from "@morlay/zephyr";
import { SessionAgentControl } from "../../../contract/session-agent-control.contract.ts";
import { SessionBranch } from "../../../contract/session-branch.contract.ts";
import { asRdbStore } from "../../../contract/session-rdb-store.contract.ts";
import { resetDerivedState, type DerivedStateResetDeps } from "./reset.ts";
import {
  SessionBranchRdbProvider,
  type LiveAgentLike,
  type ProjectionCacheSession,
} from "./provider.ts";

export { locateTurnEnd } from "./semantics.ts";

export { liveEventsOf, replaceLiveSessionLog, truncateLiveSession } from "./live-log.ts";

export { SessionBranchRdbProvider } from "./provider.ts";
export type { LiveSessionHooks, SessionBranchProvider } from "./provider.ts";

// 分支行：把持久化后端的行级端口接到 `sessionBranch` 契约上，并负责 live 会话的内存 log 失效。
@Injectable()
export class SessionBranchRdb extends SessionBranch implements OnInit {
  private readonly persistence = inject(SessionPersistence);

  private readonly sessions = inject(SessionStore);

  private readonly projections = inject.optional(SessionProjectionStore);

  private readonly agents = inject.optional(SessionAgentControl);

  private readonly logger = inject(Logger);

  // `lookup` 的读面（agent 目录 / token-meter / 投影检查点）：它们在**调用时**按名字现读，
  // 因为晚挂载的服务在装配期回填的那份引用不会随之更新。
  private row: Context | undefined;

  private readonly warned = new Set<string>();

  private provider: SessionBranchRdbProvider | undefined;

  onInit(ctx: Context): void {
    this.row = ctx;
    const store = asRdbStore(this.persistence);
    this.provider = new SessionBranchRdbProvider(store.branchPort(), {
      getSession: (id) => this.sessions.get(id),
      getAgent: (id) =>
        this.lookup<{ get(id: SessionId): LiveAgentLike | undefined }>("agents")?.get(id),
      flush: (session) => this.sessions.flush(session),
      warn: (message) => this.logger.warn(message),
      resetProjections: (session) => resetDerivedState(session, this.resetDeps()),
      resetTokenMeter: (session) => resetDerivedState(session, this.resetDeps()),
      refreshProjectionCache: async (session) => {
        // 投影缓存行可能晚于本行挂载（装配顺序按清单），所以在**调用时**按服务名读。
        const cache = this.lookup<ProjectionCacheLike>("sessionProjectionCache");
        if (cache === undefined) return;
        const cold = session.snapshotEvents().length === 0;
        if (cold && session.headSeq !== undefined && cache.truncateTo !== undefined) {
          try {
            await cache.truncateTo(session.header, session.inheritedEventCount, session.headSeq);
          } catch (error: unknown) {
            this.logger.warn(
              `session-rdb: projection cache truncate after rewind for "${session.id}" failed: ${describeError(error)}`,
            );
          }
          return;
        }
        try {
          await cache.write(session);
        } catch (error: unknown) {
          if (session.headSeq !== undefined && cache.truncateTo !== undefined) {
            try {
              await cache.truncateTo(session.header, session.inheritedEventCount, session.headSeq);
            } catch (fallbackError: unknown) {
              this.logger.warn(
                `session-rdb: projection cache truncate fallback after rewind for "${session.id}" failed: ${describeError(fallbackError)}`,
              );
            }
          }
          this.logger.warn(
            `session-rdb: projection cache rebuild after rewind for "${session.id}" failed (fell back to truncating the cache at the new head): ${describeError(error)}`,
          );
        }
      },
    });
  }

  // 覆盖导入等整段替换内存 log 的路径复用 rewind 的失效钩子（token-meter 水位是位置不是事件身份）。
  resetLiveDerivedState(session: Session): void {
    resetDerivedState(session, this.resetDeps());
  }

  readBranchPrefix(
    id: SessionId,
    atSeq?: number,
    mode?: BranchAnchorMode,
    signal?: AbortSignal,
  ): Promise<BranchBoundary> {
    return this.providerOf().readBranchPrefix(id, atSeq, mode, signal);
  }

  readRawEvents(
    id: SessionId,
    signal?: AbortSignal,
  ): Promise<{ meta: SessionHeader; events: readonly SessionEvent[] }> {
    return this.providerOf().readRawEvents(id, signal);
  }

  forkFrom(
    sourceId: SessionId,
    options?: ForkFromOptions,
    signal?: AbortSignal,
  ): Promise<SessionId> {
    return this.providerOf().forkFrom(sourceId, options, signal);
  }

  rewind(
    id: SessionId,
    toBoundary: number,
    signal?: AbortSignal,
  ): Promise<SessionPersistenceSnapshot> {
    return this.providerOf().rewind(id, toBoundary, signal);
  }

  private providerOf(): SessionBranchRdbProvider {
    if (this.provider === undefined) throw new Error("session-rdb: 分支行还没装配");
    return this.provider;
  }

  // 可选能力按名字在**调用时**读：晚挂载的服务也要看得到。
  //
  // 只剩三条走这里，各自的原因不同（都不该被"统一成契约令牌"抹平）：
  // - `agents`：`getAgent` 要的是上游 `Agent` 的 **private 面**（`requestHeaderLogged` 与 `inbox`），
  //   `AgentDirectory` 契约上只有 `get` / `list`；测试装配（`mountRows`）里替身也是在装配之后才发布的。
  // - `tokenMeter`：复位读的是上游 private 字段 `states`（`WeakMap`），任何契约都不覆盖它。
  // - `sessionProjectionCache`：晚挂载（装配顺序在清单靠后），且本包实现是 `implements` 上游契约
  //   而不是继承它（令牌与 `SessionProjectionCache` 不等），另外复位要用本包扩展的 `truncateTo`。
  private lookup<T>(name: string): T | undefined {
    return (this.row as unknown as { get(n: string, s?: boolean): unknown } | undefined)?.get(
      name,
      false,
    ) as T | undefined;
  }

  private resetDeps(): DerivedStateResetDeps {
    return {
      projections: () => this.projections,
      tokenMeter: () => this.lookup("tokenMeter"),
      warnOnce: (key, message) => {
        if (this.warned.has(key)) return;
        this.warned.add(key);
        this.logger.warn(message);
      },
    };
  }
}

interface ProjectionCacheLike {
  write(session: ProjectionCacheSession): Promise<void>;
  truncateTo?(
    header: SessionHeader,
    inheritedEventCount: SessionLogOffset,
    headSeq: number,
  ): Promise<void>;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
