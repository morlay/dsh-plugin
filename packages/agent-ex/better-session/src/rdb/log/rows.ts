import { SessionId, SessionSeq } from "@morlay/dsh-session/contract";
import type { InsertRow, RowOf } from "@morlay/zephyr-rdb";
import { sessions } from "../entities/index.ts";
import type { SessionEvent, SessionHeader, SurfaceOp } from "@morlay/dsh-session/contract";
import type { SessionStorageMetadata } from "@morlay/dsh-session-persistence/contract";
import type { EventRow, SessionRow } from "../backend.ts";

function normalizeSurfaceOp(value: unknown): SurfaceOp {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value as SurfaceOp;
  }
  const record = value as Record<string, unknown>;
  if (record["op"] !== "replace") return value as SurfaceOp;
  const startSeq = record["startSeq"] ?? record["start"];
  const endSeq = record["endSeq"] ?? record["end"];
  if (typeof startSeq !== "number" || typeof endSeq !== "number") return value as SurfaceOp;
  return { op: "replace", startSeq: SessionSeq(startSeq), endSeq: SessionSeq(endSeq) };
}

export function rowToMeta(row: SessionRow): SessionHeader {
  if (!Number.isSafeInteger(row.fCreatedAt) || row.fCreatedAt < 0) {
    throw new Error("stored session createdAt must be a non-negative safe integer");
  }
  return {
    version: row.fVersion as SessionHeader["version"],
    id: SessionId(row.fSessionId),
    createdAt: row.fCreatedAt,
    ...(row.fCwd !== null ? { cwd: row.fCwd } : {}),
    ...(row.fParentSession !== null ? { parentSession: SessionId(row.fParentSession) } : {}),
    isSeeded: row.fSeedLength !== null,
    ...(row.fOrigin !== null ? { origin: row.fOrigin as "subagent" } : {}),
    ...(row.fDelegationDepth === null ? {} : { delegationDepth: row.fDelegationDepth }),
    ...(row.fAgentPreset === null ? {} : { agentPreset: row.fAgentPreset }),
  };
}

/** 新建会话行（列名即表定义里的列，值全部显式给出）。 */
export function sessionInsertColumns(
  storage: SessionStorageMetadata,
  incarnation: string,
): InsertRow<RowOf<typeof sessions>> {
  return {
    ...sessionHeaderColumns(storage),
    f_session_id: storage.meta.id,
    f_head_event_id: "",
    f_head_sequence: -1,
    f_incarnation: incarnation,
    f_revision: 0,
  };
}

/** header 的八列（`upsert` 时「变了的列才写」判据也用它）。 */
export function sessionHeaderColumns(storage: SessionStorageMetadata): {
  f_version: number;
  f_created_at: number;
  f_cwd: string | null;
  f_parent_session: string | null;
  f_seed_length: number | null;
  f_origin: string | null;
  f_delegation_depth: number | null;
  f_agent_preset: string | null;
} {
  const meta = storage.meta;
  return {
    f_version: meta.version,
    f_created_at: meta.createdAt,
    f_cwd: meta.cwd ?? null,
    f_parent_session: meta.parentSession ?? null,
    f_seed_length: meta.isSeeded ? storage.inheritedEventCount : null,
    f_origin: meta.origin ?? null,
    f_delegation_depth: meta.delegationDepth ?? null,
    f_agent_preset: meta.agentPreset ?? null,
  };
}

export function rowToEvent(row: EventRow): SessionEvent {
  const surfaceOp =
    row.fSurfaceOp !== null ? normalizeSurfaceOp(JSON.parse(row.fSurfaceOp) as unknown) : undefined;
  const record = JSON.parse(row.fData) as unknown;

  const full =
    typeof record === "object" &&
    record !== null &&
    !Array.isArray(record) &&
    typeof (record as Record<string, unknown>)["type"] === "string" &&
    typeof (record as Record<string, unknown>)["seq"] === "number" &&
    typeof (record as Record<string, unknown>)["time"] === "number" &&
    "data" in (record as Record<string, unknown>);
  if (full) {
    // 直接改写出参而不是 `{...record}`：冷读一页就是几万次，spread 在这里是纯开销。
    const event = record as SessionEvent & { seq: number; time: number; surfaceOp?: unknown };
    event.seq = row.fSequence as SessionEvent["seq"];
    event.time = row.fCreatedAt as SessionEvent["time"];
    if (surfaceOp !== undefined) event.surfaceOp = surfaceOp;
    return event as SessionEvent;
  }
  return {
    type: row.fType as SessionEvent["type"],
    seq: row.fSequence,
    time: row.fCreatedAt,
    data: record as SessionEvent["data"],
    ...(surfaceOp === undefined ? {} : { surfaceOp }),
  } as SessionEvent;
}

// 与上游 `SURFACE_EVENT_TYPES`（`…/core/session/src/surface.ts`）同一集合：`developer/message` 承载
// 工具清单的增删通知，同样是模型可见的 surface 事件，漏掉它会把它的 `surfaceOp` 当「非 surface 事件带的
