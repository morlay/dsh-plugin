// 分支行：把持久化后端的行级端口接到 SessionBranch 契约上，并负责 live 会话的内存 log 失效。
//
// 前缀读取与 fork / rewind 在 provider / fork / rewind 里；这里只有契约行与装配。
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
} from "@morlay/better-session/endpoint";
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import { SessionStore } from "@morlay/dsh-session";
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

  private readonly agents = inject.optional(SessionAgentControl);

  private readonly logger = inject(Logger);

  // 可选能力（投影注册表 / token-meter / agent 目录）在**调用时**按名字读：装配里可能晚于本行挂载，
  // 装配期回填的那份引用不会随之更新。
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
  private lookup<T>(name: string): T | undefined {
    return (this.row as unknown as { get(n: string, s?: boolean): unknown } | undefined)?.get(
      name,
      false,
    ) as T | undefined;
  }

  private resetDeps(): DerivedStateResetDeps {
    return {
      projections: () => this.lookup("sessionProjections"),
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
