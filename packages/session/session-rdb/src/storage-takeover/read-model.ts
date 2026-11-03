import type { Database } from "@morlay/rdbkit";
import {
  and,
  E,
  eq,
  gte,
  isNull,
  lt,
  notInSubquery,
  or,
  type Condition,
  type ExprOperand,
} from "@morlay/rdbkit";
import type { EventRow, ReadModel, SessionRow } from "../backend.ts";
import { events, sessionEvents, sessions } from "../entities/index.ts";

export type { ReadModel };

export function createReadModel(database: Database): ReadModel {
  const sessionsTable = sessions.table(database);
  const eventsTable = events.table(database);
  const links = sessionEvents.table(database);

  return {
    async getSession(id) {
      for await (const row of sessionsTable.select().where(eq(sessionsTable.f_session_id, id))) {
        return sessionRowOf(row);
      }
      return undefined;
    },

    async getEventRows(id, fromSequence) {
      const rows: EventRow[] = [];
      const condition =
        fromSequence === undefined
          ? eq(links.f_session_id, id)
          : and(eq(links.f_session_id, id), gte(links.f_sequence, fromSequence));
      for await (const row of links
        .select({
          fEventId: links.f_event_id,
          fSequence: links.f_sequence,
          fType: eventsTable.f_type,
          fKind: eventsTable.f_kind,
          fRole: eventsTable.f_role,
          fName: eventsTable.f_name,
          fActionId: eventsTable.f_action_id,
          fCreatedAt: eventsTable.f_created_at,
          fData: eventsTable.f_data,
          fSurfaceOp: links.f_surface_op,
        })
        .join(events, eq(eventsTable.f_event_id, links.f_event_id))
        .where(condition)
        .orderBy("f_sequence")) {
        rows.push(eventRowOf(row));
      }
      return rows;
    },

    async getEventTypeAt(id, sequence) {
      for await (const row of links
        .select({ fType: eventsTable.f_type })
        .join(events, eq(eventsTable.f_event_id, links.f_event_id))
        .where(and(eq(links.f_session_id, id), eq(links.f_sequence, sequence)))
        .limit(1)) {
        return row.fType;
      }
      return undefined;
    },

    async getEventTypesBefore(id, beforeSequence, limit) {
      const rows: Array<Pick<EventRow, "fSequence" | "fType">> = [];
      for await (const row of links
        .select({ fSequence: links.f_sequence, fType: eventsTable.f_type })
        .join(events, eq(eventsTable.f_event_id, links.f_event_id))
        .where(and(eq(links.f_session_id, id), lt(links.f_sequence, beforeSequence)))
        .orderBy("f_sequence", "desc")
        .limit(limit)) {
        rows.push({ fSequence: Number(row.fSequence), fType: row.fType });
      }
      return rows;
    },

    async listSessions() {
      const rows: SessionRow[] = [];
      for await (const row of sessionsTable.select()) rows.push(sessionRowOf(row));
      return rows;
    },

    async latestTitleEvent(id) {
      for await (const row of links
        .select({ fSequence: links.f_sequence, fData: eventsTable.f_data })
        .join(events, eq(eventsTable.f_event_id, links.f_event_id))
        .where(and(eq(links.f_session_id, id), eq(eventsTable.f_type, "session/title")))
        .orderBy("f_sequence", "desc")
        .limit(1)) {
        return { fSequence: Number(row.fSequence), fData: row.fData };
      }
      return undefined;
    },

    async listOrphanSubagentSessions() {
      const ids: string[] = [];
      for await (const row of sessionsTable
        .select({ id: sessionsTable.f_session_id })
        .where(
          and(
            eq(sessionsTable.f_origin, "subagent"),
            or(
              isNull(sessionsTable.f_parent_session),
              notInSubquery(
                sessionsTable.f_parent_session,
                sessionsTable.select({ id: sessionsTable.f_session_id }).toFragment(),
              ),
            ),
          ),
        )) {
        ids.push(row.id);
      }
      return ids;
    },
  };
}

/** `f_last_event_at` 的「只增不减」（两方言同一份表达式，值走绑定）。 */
export function lastEventAtExpr(value: number): ExprOperand<number> {
  return E.maxOf(E.column("f_last_event_at"), value);
}

/** header 的「变了才写」条件：逐列 `IS DISTINCT FROM` 的 OR（值全部走绑定参数）。 */
export function headerChangedCondition(
  header: Readonly<Record<string, string | number | null>>,
): Condition {
  return E.or(
    ...Object.entries(header).map(([name, value]) =>
      E.isDistinctFrom(E.column(name, "t_sessions"), value),
    ),
  );
}

/**
 * 事件行的数值列统一收回 number：`f_created_at` 在表定义里是 `bigint`（rdbkit 读回 BigInt），
 * 事件坐标与毫秒时间都在安全整数范围内。
 */
function eventRowOf(row: {
  fEventId: string;
  fSequence: number | bigint;
  fType: string;
  fKind: string;
  fRole: string;
  fName: string;
  fActionId: string;
  fCreatedAt: number | bigint;
  fData: string;
  fSurfaceOp: string | null;
}): EventRow {
  return {
    fEventId: row.fEventId,
    fSequence: Number(row.fSequence),
    fType: row.fType,
    fKind: row.fKind,
    fRole: row.fRole,
    fName: row.fName,
    fActionId: row.fActionId,
    fCreatedAt: Number(row.fCreatedAt),
    fData: row.fData,
    fSurfaceOp: row.fSurfaceOp,
  };
}

/** 列名原样 → 会话行的 camelCase（列名由表定义固定，这里是唯一一处映射）。 */
export function sessionRowOf(row: Record<string, unknown>): SessionRow {  return {
    fSessionId: String(row["f_session_id"]),
    fHeadEventId: String(row["f_head_event_id"]),
    fHeadSequence: Number(row["f_head_sequence"]),
    fVersion: Number(row["f_version"]),
    fCreatedAt: Number(row["f_created_at"]),
    fCwd: (row["f_cwd"] as string | null) ?? null,
    fParentSession: (row["f_parent_session"] as string | null) ?? null,
    fSeedLength: row["f_seed_length"] === null ? null : Number(row["f_seed_length"]),
    fOrigin: (row["f_origin"] as string | null) ?? null,
    fDelegationDepth: row["f_delegation_depth"] === null ? null : Number(row["f_delegation_depth"]),
    fAgentPreset: (row["f_agent_preset"] as string | null) ?? null,
    fIncarnation: String(row["f_incarnation"]),
    fRevision: Number(row["f_revision"]),
    fArchivedAt: row["f_archived_at"] === null ? null : Number(row["f_archived_at"]),
    fPinnedSeq: row["f_pinned_seq"] === null ? null : Number(row["f_pinned_seq"]),
    fLastEventAt: row["f_last_event_at"] === null ? null : Number(row["f_last_event_at"]),
  };
}
