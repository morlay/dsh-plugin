import { SESSION_FORMAT_VERSION, SessionId } from "@morlay/dsh-session/contract";
import type { SessionEvent, SessionHeader } from "@morlay/dsh-session/contract";
import { sessionFormatLogFilename } from "@morlay/dsh-session/contract";
import { balanceRewindPrefix } from "@morlay/better-session/endpoint";
import { adoptLegacyRows, convertLegacyRows, isLegacyVersion } from "./legacy.ts";
import { scanRows, toJsonlArtifact } from "./log/export.ts";
import { needsShapeAdoption, repairReadView } from "./log/repair.ts";
import { rowToMeta } from "./log/rows.ts";
import type {
  SessionPersistenceRevision,
  SessionPersistenceSnapshot,
} from "@morlay/dsh-session-persistence/contract";
import type { Backend, SessionRow } from "./backend.ts";
import type { RdbBackendTracker } from "./handles.ts";

export interface ReadPathDeps {
  readonly ready: Promise<void>;
  backend(): Backend;
  readonly tracker: RdbBackendTracker;
  readonly logger: { warn(message: string): void };
  /** materialization 身份的 revision 串（`storeIdentity:incarnation:…`）。 */
  revisionOf(row: SessionRow): SessionPersistenceRevision;
}

/**
 * 读侧：会话日志、原始导出、快照列表与已存储 revision。
 *
 * 这些只读 `backend.reads`，不碰写事务；`session-store.ts` 的契约方法（`load` / `open` / `readFrom`）把调用转到这里。
 */
export function createReadPath(deps: ReadPathDeps) {
  return {
    async readLog(
      id: SessionId,
      options: { fromSeq?: number } = {},
      signal?: AbortSignal,
    ): Promise<
      | {
          meta: SessionHeader;

          inheritedEventCount: number;
          events: SessionEvent[];
          tornFrom?: number;

          incarnation: string;

          revision: number;

          storedCount: number;

          migrated: boolean;
        }
      | undefined
    > {
      signal?.throwIfAborted();
      await deps.ready;
      signal?.throwIfAborted();
      const row = await deps.backend().reads.getSession(id);
      if (row === undefined) return undefined;
      const meta = rowToMeta(row);
      const eventRows =
        options.fromSeq === undefined
          ? await deps.backend().reads.getEventRows(id)
          : await deps.backend().reads.getEventRows(id, options.fromSeq);
      signal?.throwIfAborted();

      if (isLegacyVersion(row.fVersion)) {
        try {
          const converted = convertLegacyRows(row, eventRows);
          return {
            meta: converted.meta,
            inheritedEventCount: converted.inheritedEventCount,
            events: converted.events,
            incarnation: row.fIncarnation,
            revision: row.fRevision,
            storedCount: eventRows.length,
            migrated: true,
          };
        } catch (error: unknown) {
          deps.logger.warn(
            `session-rdb: session "${id}" is not a single released format; adopting its stored rows as current-format data (${error instanceof Error ? error.message : String(error)})`,
          );
          const adopted = adoptLegacyRows(row, eventRows);
          return {
            meta: adopted.meta,
            inheritedEventCount: adopted.inheritedEventCount,
            events: adopted.events,
            incarnation: row.fIncarnation,
            revision: row.fRevision,
            storedCount: eventRows.length,
            migrated: false,
            ...(adopted.tornFrom !== undefined ? { tornFrom: adopted.tornFrom } : {}),
          };
        }
      }
      const { preserved, tornFrom } = scanRows(eventRows, options.fromSeq ?? 0);
      // 版本号不完全可信：写路径曾把回退视图的结果以当前版本号落库，于是库里存在「v4 标记 + 旧代形状」
      // 的行——在扫干净的边界之内再按内容判一次（撕裂尾部与坏行已经被 `scanRows` 丢掉了）。
      if (needsShapeAdoption(preserved)) {
        const adopted = adoptLegacyRows(row, eventRows);
        return {
          meta: adopted.meta,
          inheritedEventCount: adopted.inheritedEventCount,
          events: adopted.events,
          incarnation: row.fIncarnation,
          revision: row.fRevision,
          storedCount: eventRows.length,
          migrated: false,
          ...(adopted.tornFrom !== undefined ? { tornFrom: adopted.tornFrom } : {}),
        };
      }
      return {
        meta,
        inheritedEventCount: row.fSeedLength ?? 0,
        events: preserved,
        incarnation: row.fIncarnation,
        revision: row.fRevision,
        storedCount: eventRows.length,
        migrated: false,
        ...(tornFrom !== undefined ? { tornFrom } : {}),
      };
    },

    async readRaw(
      id: SessionId,
      signal?: AbortSignal,
    ): Promise<
      | { meta: SessionHeader; inheritedEventCount: number; filename: string; content: string }
      | undefined
    > {
      signal?.throwIfAborted();
      await deps.ready;
      signal?.throwIfAborted();
      const log = await this.readLog(id, {}, signal);
      if (log === undefined) return undefined;
      repairReadView(log.events);
      // 整段日志导出：只丢弃「已不平衡」之后的尾部（尾部未闭合的 step 是中断运行的正常形状，由上游 resume 补 closers）
      const events = balanceRewindPrefix(log.events, { keepOpenTail: true });
      const inheritedEventCount = Math.min(log.inheritedEventCount, events.length);
      return {
        meta: log.meta,
        inheritedEventCount,

        filename: sessionFormatLogFilename(SESSION_FORMAT_VERSION),
        content: toJsonlArtifact(log.meta, inheritedEventCount, events),
      };
    },

    async listSnapshots(
      signal?: AbortSignal,
    ): Promise<Array<SessionPersistenceSnapshot & { inheritedEventCount: number }>> {
      signal?.throwIfAborted();
      await deps.ready;
      signal?.throwIfAborted();
      const snapshots: Array<SessionPersistenceSnapshot & { inheritedEventCount: number }> = [];
      const listed = new Set<SessionId>();
      for (const [id, pending] of deps.tracker.pendingEntries()) {
        snapshots.push({
          header: pending.header,
          revision: pending.revision,
          inheritedEventCount: pending.inheritedEventCount,
        });
        listed.add(id);
      }
      const rows = await deps.backend().reads.listSessions();
      signal?.throwIfAborted();
      for (const row of rows) {
        if (listed.has(SessionId(row.fSessionId))) continue;
        snapshots.push({
          header: rowToMeta(row),
          revision: deps.revisionOf(row),
          inheritedEventCount: row.fSeedLength ?? 0,
        });
      }
      return snapshots;
    },

    async readStoredRevision(
      id: SessionId,
      signal?: AbortSignal,
    ): Promise<SessionPersistenceRevision | undefined> {
      signal?.throwIfAborted();
      await deps.ready;
      signal?.throwIfAborted();
      const row = await deps.backend().reads.getSession(id);
      if (row === undefined) return undefined;
      return deps.revisionOf(row);
    },
  };
}
