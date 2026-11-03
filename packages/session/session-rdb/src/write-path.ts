import { randomUUID } from "node:crypto";
import {
  SessionLogOffset,
  type SessionEvent,
  type SurfaceEventType,
  type SessionHeader,
  type SessionId,
} from "@deepseek-ai/dsh-session";
import { validateStoredEvents } from "@deepseek-ai/dsh-session-persistence";
import type { Backend, BackendTx, EventInsert } from "./backend.ts";
import type { WriteGuard } from "./write-guard.ts";
import type { RdbBackendTracker } from "./handles.ts";
import { EVENT_ENCODING } from "./version.ts";
import { eventDimensions } from "./event-shape.ts";
import { usageRowOf, type EventUsageRow } from "./log/usage-row.ts";
import { sealOwnEvents } from "./log/repair.ts";
import { sessionCountBuckets, sessionUsageBuckets } from "./stats-fold.ts";

function maxEventTime(events: readonly { readonly time?: number }[]): number | undefined {
  let max: number | undefined;
  for (const event of events) {
    const time = event.time;
    if (typeof time !== "number") continue;
    if (max === undefined || time > max) max = time;
  }
  return max;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

export interface WritePathDeps {
  readonly ready: Promise<void>;
  backend(): Backend;
  readonly tracker: RdbBackendTracker;
  readonly writeGuard: WriteGuard;
  readonly reuseEventIds: Map<SessionId, Map<number, string>>;
  readonly logger: { warn(message: string): void };
  readLog(id: SessionId): Promise<
    | { meta: SessionHeader; inheritedEventCount: number; events: SessionEvent[] }
    | undefined
  >;
}

/**
 * 写侧：空会话物化、批量追加、统计旁路累加与重算、迁移后重写。
 *
 * 事务边界都在这里；`session-store.ts` 只负责装配与契约转发。
 */
export function createWritePath(deps: WritePathDeps) {
  return {
    async materializeEmpty(
    meta: SessionHeader,
    inheritedEventCount: SessionLogOffset,
  ): Promise<void> {
    await deps.ready;
    await deps.backend().transaction(async (tx) => {
      await tx.upsertSession({ meta, inheritedEventCount }, randomUUID());
      await tx.bumpRevision(meta.id);
    });
    deps.tracker.materialized(meta.id);
    deps.writeGuard.confirmHead(meta.id, -1);
  },

    async appendBatch(
    meta: SessionHeader,
    inheritedEventCount: SessionLogOffset,
    events: readonly SessionEvent[],
    tornTruncateTo?: number,
  ): Promise<boolean> {
    await deps.ready;
    if (events.length === 0) return false;

    // 本仓库自造的事件类型落库前补上 `ignorable` 信封：不补的话上游那道校验连写入都拒。
    sealOwnEvents(events);
    validateStoredEvents(meta, [...events]);

    const reuse = deps.reuseEventIds.get(meta.id);
    let confirmedHead = -1;
    // 本批用量行由 `appendEventTail` 折好；事务成功后旁路据此累加 token 汇总表。
    let usageRows: EventUsageRow[] = [];
    await deps.backend().transaction(async (tx) => {
      if (tornTruncateTo !== undefined) {
        await tx.deleteBridgeTail(meta.id, tornTruncateTo);
        const prev = await tx.getPrevBridge(meta.id, tornTruncateTo - 1);
        if (prev === undefined) {
          await tx.updateHead(meta.id, "", -1);
        } else {
          await tx.updateHead(meta.id, prev.fEventId, prev.fSequence);
        }
      }
      await tx.upsertSession({ meta, inheritedEventCount }, randomUUID());
      const head = await tx.getHead(meta.id);

      deps.writeGuard.assertNoConcurrentWriter(meta.id, head.fHeadSequence);
      const appended = await appendEventTail(
        tx,
        meta,
        events,
        { parentId: head.fHeadEventId, nextSeq: head.fHeadSequence + 1 },
        reuse,
      );
      usageRows = appended.usageRows;
      await tx.updateHeadAndRevision(
        meta.id,
        appended.headEventId,
        appended.headSequence,
        maxEventTime(events),
      );
      confirmedHead = appended.headSequence;
    });
    // 事务**成功之后**才丢掉复用映射：失败（并发写者校验、唯一键冲突等）时这份映射还没被消费，
    // 重试同一个 append 还要靠它复用父会话的事件行——提前删掉会让前缀事件行被重新插入一遍。
    if (reuse !== undefined) deps.reuseEventIds.delete(meta.id);

    deps.writeGuard.confirmHead(meta.id, confirmedHead);
    deps.tracker.materialized(meta.id);
    await this.recordSessionStats(meta.id, events, usageRows);
    return true;
  },


    async recordSessionStats(
    id: SessionId,
    events: readonly SessionEvent[],
    usageRows: readonly EventUsageRow[],
  ): Promise<void> {
    const usageBuckets = sessionUsageBuckets(usageRows);
    if (usageBuckets.length > 0) {
      try {
        await deps.backend().incrementSessionUsage(id, usageBuckets);
      } catch (error: unknown) {
        deps.logger.warn(
          `session-rdb: token usage for "${id}" not updated (${describeError(error)})`,
        );
      }
    }
    const countBuckets = sessionCountBuckets(events);
    if (countBuckets.length > 0) {
      try {
        await deps.backend().incrementSessionCounts(id, countBuckets);
      } catch (error: unknown) {
        deps.logger.warn(
          `session-rdb: activity counts for "${id}" not updated (${describeError(error)})`,
        );
      }
    }
  },

  // 重算一个会话的两张汇总表（旧日志重写后；best-effort，同 `recordSessionStats`）——
  // fork 与 rewind 都不动统计。
    async rebuildSessionStats(id: SessionId): Promise<void> {
    await deps.ready;
    try {
      await deps.backend().rebuildSessionStats(id);
    } catch (error: unknown) {
      deps.logger.warn(
        `session-rdb: session stats for "${id}" not rebuilt (${describeError(error)})`,
      );
    }
  },

  // 重算这些用量行的引用标记（会话删除 / 日志重写之后：消失的引用要让孤儿行退出统计）。
    async refreshEventUsageFlags(eventIds: readonly string[]): Promise<void> {
    const unique = [...new Set(eventIds)];
    if (unique.length === 0) return;
    try {
      await deps.backend().refreshEventUsageFlags(unique);
    } catch (error: unknown) {
      deps.logger.warn(
        `session-rdb: usage reference flags not refreshed (${describeError(error)})`,
      );
    }
  },

  // 会话删除时清掉它的汇总行（引用标记由调用方在拿到被删事件后一并重算）。
    async dropSessionStats(id: SessionId): Promise<void> {
    try {
      await deps.backend().deleteSessionStats(id);
    } catch (error: unknown) {
      deps.logger.warn(
        `session-rdb: session stats for "${id}" not deleted (${describeError(error)})`,
      );
    }
  },

    async rewriteMigratedLog(
    id: SessionId,
    log: { meta: SessionHeader; inheritedEventCount: number; events: SessionEvent[] },
  ): Promise<void> {
    let removed: readonly string[] = [];
    await deps.backend().transaction(async (tx) => {
      // 重写会删光该会话的桥接行再重建，先做并发写者校验（与 `appendBatch` 同一个理由）：否则另一实例在
      // open 前 / 期间提交的事件会被静默丢掉；调用方刚读过这份日志，guard 没有该会话时记下当前磁盘 head。
      const head = await tx.getHead(id);
      if (!deps.writeGuard.has(id)) deps.writeGuard.confirmHead(id, head.fHeadSequence);
      deps.writeGuard.assertNoConcurrentWriter(id, head.fHeadSequence);
      removed = await tx.deleteBridgeTail(id, 0);
      await tx.upsertSession(
        { meta: log.meta, inheritedEventCount: SessionLogOffset(log.inheritedEventCount) },
        randomUUID(),
      );
      const appended = await appendEventTail(tx, log.meta, log.events, {
        parentId: "",
        nextSeq: 0,
      });
      await tx.updateHead(id, appended.headEventId, appended.headSequence);
      await tx.bumpRevision(id, maxEventTime(log.events));
    });
    // 重写换了事件行：被删掉的那批成了孤儿（引用标记要落回 0），本会话汇总按新事件重算。
    await this.rebuildSessionStats(id);
    await this.refreshEventUsageFlags(removed);
  },

  };
}

async function appendEventTail(
  tx: BackendTx,
  meta: SessionHeader,
  events: readonly SessionEvent[],
  anchor: { parentId: string; nextSeq: number },
  reuse?: ReadonlyMap<number, string>,
): Promise<{ headEventId: string; headSequence: number; usageRows: EventUsageRow[] }> {
  let parentId = anchor.parentId;
  let nextSeq = anchor.nextSeq;

  const eventRows: EventInsert[] = [];
  const usageRows: EventUsageRow[] = [];
  const bridgeRows: Array<{
    fSessionId: SessionId;
    fEventId: string;
    fSequence: number;
    fSurfaceOp: string | null;
  }> = [];
  for (const event of events) {
    const reusedId = reuse?.get(event.seq);
    const eventId = reusedId ?? randomUUID();
    if (reusedId === undefined) {
      const { kind, role, name, actionId } = eventDimensions(event);

      const raw = event as SessionEvent & {
        ignorable?: unknown;
        surfaceOp?: unknown;
        sourceEventSeqs?: unknown;
      };
      const { data, surfaceOp: _surfaceOp, sourceEventSeqs: _sourceEventSeqs, ...envelope } = raw;
      const row: EventInsert = {
        fEventId: eventId,
        fParentId: parentId,
        fType: event.type,
        fKind: kind,
        fRole: role,
        fName: name,
        fActionId: actionId,
        fEncoding: EVENT_ENCODING,
        fData: JSON.stringify({ ...envelope, data }),
        fCreatedAt: event.time,
      };
      eventRows.push(row);
      // 用量行在这里一次折好（读侧维度一起物化），后端只负责插入，事务后旁路再据此累加汇总表。
      const usageRow = usageRowOf(row, meta.origin === "subagent");
      if (usageRow !== undefined) usageRows.push(usageRow);
    }
    const surfaceOp =
      (event as SessionEvent<SurfaceEventType>).surfaceOp === undefined
        ? null
        : JSON.stringify((event as SessionEvent<SurfaceEventType>).surfaceOp);
    bridgeRows.push({
      fSessionId: meta.id,
      fEventId: eventId,
      fSequence: nextSeq,
      fSurfaceOp: surfaceOp,
    });
    parentId = eventId;
    nextSeq++;
  }
  if (eventRows.length > 0) await tx.insertEvents(eventRows, usageRows);
  await tx.insertBridges(bridgeRows);

  if (events.some((event) => (event.type as string) === "session/title")) {
    await tx.refreshTitle(meta.id);
  }
  return { headEventId: parentId, headSequence: nextSeq - 1, usageRows };
}
