// handle 模型契约（上游 SessionPersistence）：创建 / 打开 / 快照 / 日志读取与已存储 revision。
//
// 门面（admin/store.ts）只装配与转发，实现都在这里；端口见 ./store-ports.ts。
import {
  SessionId as toSessionId,
  SessionLogOffset,
  type SessionHeader,
  type SessionId,
} from "@morlay/dsh-session/contract";
import {
  SessionAlreadyExistsError,
  SessionPersistenceNotFoundError,
  materializeCreateHeader,
  validateStoredEvents,
  type SessionAccess,
  type SessionHandle,
  type SessionPersistenceCreateOptions,
  type SessionPersistenceListOptions,
  type SessionPersistenceOpenOptions,
  type SessionPersistenceSnapshot,
  type SessionPersistenceStatOptions,
} from "@morlay/dsh-session-persistence/contract";
import { RdbSessionHandle } from "./handles.ts";
import { repairReadView } from "./read-view/index.ts";
import { rowToMeta } from "./log/rows.ts";
import type { StorePorts } from "./store-ports.ts";

/**
 * handle 模型：创建、打开、快照、日志读取与已存储 revision。
 * @param deps - 数据面端口。
 * @returns 契约方法（门面逐个转发）。
 */
export function createHandleModel(deps: StorePorts) {
  return {
    async create(
      header: SessionHeader,
      options?: SessionPersistenceCreateOptions,
    ): Promise<SessionHandle> {
      options?.signal?.throwIfAborted();
      const snapshot = materializeCreateHeader(header);
      if (snapshot.isSeeded && options?.inheritedEventCount === undefined) {
        throw new TypeError("seeded session metadata requires an inherited event count");
      }
      const inheritedEventCount = SessionLogOffset(options?.inheritedEventCount ?? 0);
      if (!snapshot.isSeeded && inheritedEventCount !== 0) {
        throw new TypeError("unseeded session metadata inherited event count must be 0");
      }
      await deps.ready();
      options?.signal?.throwIfAborted();
      if (
        deps.tracker.hasPending(snapshot.id) ||
        (await deps.backend().reads.getSession(snapshot.id)) !== undefined
      ) {
        throw new SessionAlreadyExistsError(snapshot.id);
      }
      deps.tracker.registerCreated(snapshot, inheritedEventCount);
      return deps.tracker.adopt(
        new RdbSessionHandle(deps.host(), snapshot.id, snapshot, "write", {
          cursor: 0,
          materialized: false,
          inheritedEventCount,
        }),
      );
    },

    async open(
      id: SessionId,
      access: SessionAccess,
      options?: SessionPersistenceOpenOptions,
    ): Promise<SessionHandle> {
      options?.signal?.throwIfAborted();
      await deps.ready();
      options?.signal?.throwIfAborted();
      const pending = deps.tracker.pendingOf(id);
      if (access === "read") {
        if (pending !== undefined) {
          return deps.tracker.adopt(
            new RdbSessionHandle(deps.host(), id, pending.header, "read", {
              cursor: 0,
              materialized: false,
              inheritedEventCount: pending.inheritedEventCount,
            }),
          );
        }
        const log = await deps.readPath().readLog(id, {}, options?.signal);
        if (log === undefined) throw new SessionPersistenceNotFoundError(id);
        repairReadView(log.events);
        validateStoredEvents(log.meta, log.events);
        return deps.tracker.adopt(
          new RdbSessionHandle(deps.host(), id, log.meta, "read", {
            cursor: log.events.length,
            materialized: true,
            inheritedEventCount: SessionLogOffset(log.inheritedEventCount),
          }),
        );
      }
      deps.tracker.claimWrite(id);
      try {
        if (pending !== undefined) {
          return deps.tracker.adopt(
            new RdbSessionHandle(deps.host(), id, pending.header, "write", {
              cursor: pending.cursor,
              materialized: false,
              inheritedEventCount: pending.inheritedEventCount,
            }),
          );
        }
        const log = await deps.readPath().readLog(id, {}, options?.signal);
        if (log === undefined) throw new SessionPersistenceNotFoundError(id);
        repairReadView(log.events);
        validateStoredEvents(log.meta, log.events);
        if (log.migrated && log.events.length !== log.storedCount) {
          await deps.writePath().rewriteMigratedLog(id, log);
        }
        deps.writeGuard.confirmHead(id, log.events.at(-1)?.seq ?? -1);
        return deps.tracker.adopt(
          new RdbSessionHandle(deps.host(), id, log.meta, "write", {
            cursor: log.events.length,
            materialized: true,
            inheritedEventCount: SessionLogOffset(log.inheritedEventCount),
            ...(log.tornFrom === undefined ? {} : { tornTruncateTo: log.tornFrom }),
          }),
        );
      } catch (error: unknown) {
        deps.tracker.releaseClaim(id);
        throw error;
      }
    },

    async stat(
      id: SessionId,
      options?: SessionPersistenceStatOptions,
    ): Promise<SessionPersistenceSnapshot | undefined> {
      options?.signal?.throwIfAborted();
      await deps.ready();
      options?.signal?.throwIfAborted();
      const pending = deps.tracker.pendingOf(id);
      if (pending !== undefined) return { header: pending.header, revision: pending.revision };
      const row = await deps.backend().reads.getSession(id);
      if (row === undefined) return undefined;
      return { header: rowToMeta(row), revision: deps.revisionOf(row) };
    },

    async list(
      options?: SessionPersistenceListOptions,
    ): Promise<readonly SessionPersistenceSnapshot[]> {
      const signal = options?.signal;
      const snapshots: SessionPersistenceSnapshot[] = [];
      const listed = new Set<SessionId>();
      for (const [id, pending] of deps.tracker.pendingEntries()) {
        snapshots.push({ header: pending.header, revision: pending.revision });
        listed.add(id);
      }
      signal?.throwIfAborted();
      await deps.ready();
      signal?.throwIfAborted();
      for (const row of await deps.backend().reads.listSessions()) {
        if (listed.has(toSessionId(row.fSessionId))) continue;
        snapshots.push({ header: rowToMeta(row), revision: deps.revisionOf(row) });
      }
      return snapshots;
    },

    // 会话行 → header + 继承前缀长度：只读会话行，不读日志（load 会把整段事件拉回来）。
    async headerOf(
      id: string,
      signal?: AbortSignal,
    ): Promise<{ header: SessionHeader; inheritedEventCount: number } | undefined> {
      signal?.throwIfAborted();
      await deps.ready();
      signal?.throwIfAborted();
      const row = await deps.backend().reads.getSession(id);
      if (row === undefined) return undefined;
      return { header: rowToMeta(row), inheritedEventCount: row.fSeedLength ?? 0 };
    },

    // 快照列表（含继承前缀账目）：源 spec 的 branch 用例比对 fork 前后的前缀。
    listSnapshots(signal?: AbortSignal) {
      return deps.readPath().listSnapshots(signal);
    },

    // 已存储的 revision：源 spec 的 branch 用例断言 rewind 之后 revision 变了。
    readStoredRevision(id: SessionId, signal?: AbortSignal) {
      return deps.readPath().readStoredRevision(id, signal);
    },
  };
}
