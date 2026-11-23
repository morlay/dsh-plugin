// 管理面的运维动作：删除会话（含派生状态重算）、整理（孤儿回收 + 统计重建 + VACUUM）、归档集合。
//
// 判据：删除与整理都先排水、再判有没有运行中的写者，拒绝比猜安全（派生表可销毁重建）。
import { SessionId as toSessionId, type SessionId } from "@morlay/dsh-session/contract";
import type { SessionStore } from "@morlay/dsh-session";
import type { Backend } from "../data/backend.ts";
import type { RdbBackendTracker } from "../data/store/handles.ts";
import { SessionStoreError } from "../data/errors.ts";
import { repairDerivations, type DerivationRepairReport } from "./consistency.ts";

/** 运维动作要的端口：只碰后端、句柄账本与归档面。 */
export interface MaintenanceDeps {
  ready(): Promise<void>;
  backend(): Backend;
  readonly tracker: RdbBackendTracker;
  sessions(): SessionStore;
  readonly reuseEventIds: Map<SessionId, Map<number, string>>;
  /** live 路由的记账回收（会话删除 / 孤儿回收时）。 */
  forgetLive(id: SessionId): void;
  drainLiveWrites(): Promise<unknown[]>;
  stopAgent(id: SessionId): Promise<void>;
  logger(): { warn(message: string): void };
}

/**
 * 运维动作：删除、整理、孤儿回收、VACUUM 与归档集合。
 * @param deps - 数据面与管理面的端口。
 * @returns 管理面方法（门面逐个转发）。
 */
export function createMaintenance(deps: MaintenanceDeps) {
  return {
    async deleteSession(id: string, signal?: AbortSignal): Promise<void> {
      await this.deleteSessionWithRepair(id, signal);
    },

    /**
     * 删除会话，并把删除之后派生状态的重算结果一并交回。
     *
     * 会话行与桥接行已经在事务里删掉了：重算失败不回滚它，但也不能只落一条 warn——失败留下的漂移
     * 正是 checkConsistency 报的那几种（统计行还在、用量引用标记还指着已删会话）。
     * @param id - 会话 id。
     * @param signal - 取消信号。
     * @returns 删掉的会话 id，与两步重算（统计行 / 用量引用标记）的结果。
     */
    async deleteSessionWithRepair(
      id: string,
      signal?: AbortSignal,
    ): Promise<{ readonly sessionId: string; readonly repair: DerivationRepairReport }> {
      const sessionId = toSessionId(id);
      signal?.throwIfAborted();
      await deps.ready();
      signal?.throwIfAborted();
      const row = await deps.backend().reads.getSession(sessionId);
      if (row === undefined) {
        throw new SessionStoreError("SESSION_NOT_FOUND", "session " + id + " not found");
      }
      if (row.fArchivedAt === null) {
        throw new SessionStoreError(
          "SESSION_NOT_ARCHIVED",
          "session " + id + " is not archived; only archived sessions can be deleted",
        );
      }
      if (deps.tracker.hasPending(sessionId) || deps.tracker.hasOpenHandle(sessionId)) {
        throw new SessionStoreError(
          "SESSION_LIVE",
          "session " + id + " is live; stop it before deleting",
        );
      }
      const referenced = await deps.backend().transaction((tx) => tx.deleteSession(sessionId));
      deps.forgetLive(sessionId);
      deps.reuseEventIds.delete(sessionId);
      const repair = await this.repairDeletedSession(sessionId, referenced);
      return { sessionId: String(sessionId), repair };
    },

    // 删除之后的两步重算：失败进 report（不吞掉，也不打断删除）。
    async repairDeletedSession(
      sessionId: SessionId,
      eventIds: readonly string[],
    ): Promise<DerivationRepairReport> {
      const repair = await repairDerivations([
        {
          step: "session-stats",
          run: () => deps.backend().deleteSessionStats(sessionId),
        },
        {
          step: "usage-flags",
          run: () => deps.backend().refreshEventUsageFlags(eventIds),
        },
      ]);
      for (const failure of repair.failures) {
        deps
          .logger()
          .warn(
            "session-rdb: deleted session " +
              String(sessionId) +
              " keeps a stale derivation (" +
              failure.step +
              "): " +
              failure.message,
          );
      }
      return repair;
    },

    async organize(): Promise<{
      orphanSessions: number;
      orphanEvents: number;
      rebuiltSessions: number;
    }> {
      await deps.ready();
      // 先排水：live 会话缓冲里的事件还没落库时清表，重算出来的账会把它们算漏。
      for (const failure of await deps.drainLiveWrites()) {
        deps
          .logger()
          .warn("session-rdb: organize drained with a pending write failure: " + String(failure));
      }
      // 停写不变量在 store 自身（不是端点的可选依赖）：还有写句柄的会话就是运行中，这时清表等于赌它不再写。
      const running = this.openWriteSessions();
      if (running.length > 0) {
        throw new SessionStoreError(
          "SESSION_ORGANIZE_LIVE",
          "session-rdb: organize refused; " +
            String(running.length) +
            " session(s) are still open for writing: " +
            running.join(", "),
        );
      }
      const orphanSessions = await this.collectOrphanSessions();
      const orphanEvents = await deps.backend().collectOrphans();
      const rebuiltSessions = await deps.backend().rebuildAllStats();
      await deps.backend().vacuum();
      return { orphanSessions, orphanEvents, rebuiltSessions };
    },

    // 「运行中」的判据是写侧的两本账：还有写句柄（会话没关），或还有没物化的 pending（建了还没落库）。
    openWriteSessions(): string[] {
      const candidates = new Set<SessionId>();
      for (const session of deps.sessions().list()) candidates.add(session.header.id);
      for (const [id] of deps.tracker.pendingEntries()) candidates.add(id);
      const running: string[] = [];
      for (const id of candidates) {
        if (deps.tracker.hasPending(id) || deps.tracker.writerOf(id) !== undefined) {
          running.push(id);
        }
      }
      return running;
    },

    async collectOrphanSessions(): Promise<number> {
      await deps.ready();
      const orphans = await deps.backend().listOrphanSubagentSessions();
      const deletable = orphans.filter(
        (id) => !deps.tracker.hasPending(id) && !deps.tracker.hasOpenHandle(id),
      );
      if (deletable.length === 0) return 0;
      const { deleted, eventIds } = await deps
        .backend()
        .transaction((tx) => tx.deleteSessions(deletable));
      for (const id of deletable) {
        deps.forgetLive(id);
        deps.reuseEventIds.delete(id);
      }
      const repair = await repairDerivations([
        ...deletable.map((id) => ({
          step: "session-stats" as const,
          run: () => deps.backend().deleteSessionStats(id),
        })),
        {
          step: "usage-flags",
          run: () => deps.backend().refreshEventUsageFlags(eventIds),
        },
      ]);
      for (const failure of repair.failures) {
        deps
          .logger()
          .warn(
            "session-rdb: orphan session recovered but a derivation is stale (" +
              failure.step +
              "): " +
              failure.message,
          );
      }
      return deleted;
    },

    async vacuum(): Promise<void> {
      await deps.ready();
      await deps.backend().vacuum();
    },

    async archivedSessionIds(): Promise<ReadonlySet<string>> {
      await deps.ready();
      const state = (await deps.backend().storage.readDomainGlobal("workspace")) as {
        archivedSessionIds?: readonly string[];
      } | null;
      return new Set((state?.archivedSessionIds ?? []).map(String));
    },

    async stopAgent(id: SessionId): Promise<void> {
      await deps.stopAgent(id);
    },
  };
}
