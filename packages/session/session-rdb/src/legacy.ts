import {
  SESSION_FORMAT_VERSION,
  type SessionEvent,
  type SessionHeader,
  type SessionId,
} from "@deepseek-ai/dsh-session";
import { createSessionFormatCatalogWithChildren } from "@deepseek-ai/dsh-session-format-catalog";
import type { EventRow, SessionRow } from "./backend.ts";
import { normalizeToCurrentShape, repairRequestHeaders, rowToMeta, scanRows } from "./log.ts";

function physicalHeader(row: SessionRow): Record<string, unknown> {
  const common = {
    type: "session",
    version: row.fVersion,
    id: row.fSessionId,
    createdAt: row.fCreatedAt,
    ...(row.fCwd !== null ? { cwd: row.fCwd } : {}),
    ...(row.fParentSession !== null ? { parentSession: row.fParentSession } : {}),
    ...(row.fOrigin !== null ? { origin: row.fOrigin } : {}),
    delegationDepth: row.fDelegationDepth ?? 0,
    ...(row.fAgentPreset !== null ? { agentPreset: row.fAgentPreset } : {}),
  };

  return row.fVersion < 2
    ? { ...common, ...(row.fSeedLength !== null ? { seedLength: row.fSeedLength } : {}) }
    : { ...common, isSeeded: row.fSeedLength !== null };
}

function physicalEvent(row: EventRow): Record<string, unknown> {
  const stored = JSON.parse(row.fData) as unknown;

  const full =
    typeof stored === "object" &&
    stored !== null &&
    !Array.isArray(stored) &&
    typeof (stored as Record<string, unknown>)["type"] === "string" &&
    "data" in (stored as Record<string, unknown>);
  return {
    type: row.fType,
    seq: row.fSequence,
    time: row.fCreatedAt,
    data: full ? (stored as Record<string, unknown>)["data"] : stored,
    ...(row.fSurfaceOp !== null ? { surfaceOp: JSON.parse(row.fSurfaceOp) as unknown } : {}),
  };
}

/**
 * 读旧格式用的 catalog：v3→v4 这条边要求显式子会话证据（上游 0.1.7 起），本仓库声明
 * **无子会话证据**——v3 的目录事实由父会话自己在成功路径上写成 `subagent/catalog` 事件，
 * 迁移的 child evidence 只是补偿入口；我们没有更权威的子集合来源可给（见 ADR-跟随上游session-format-v4）。
 */
export const restoreCatalog = createSessionFormatCatalogWithChildren([]);

export function convertLegacyRows(
  row: SessionRow,
  eventRows: readonly EventRow[],
): { meta: SessionHeader; inheritedEventCount: number; events: SessionEvent[] } {
  const restore = restoreCatalog.createRestore(physicalHeader(row), {
    recovery: "strict",
    validation: "transformed",
  });
  for (const eventRow of eventRows) {
    restore.decodeRow(physicalEvent(eventRow));
  }
  const artifact = restore.finish();
  return {
    meta: artifact.header as unknown as SessionHeader,
    inheritedEventCount: artifact.inheritedEventCount,
    events: artifact.events as unknown as SessionEvent[],
  };
}

export function isLegacyVersion(version: number): boolean {
  return version < SESSION_FORMAT_VERSION;
}

export function adoptLegacyRows(
  row: SessionRow,
  eventRows: readonly EventRow[],
): {
  meta: SessionHeader;
  inheritedEventCount: number;
  events: SessionEvent[];
  tornFrom?: number;
} {
  const { preserved, tornFrom } = scanRows(eventRows, 0);

  // 回退视图要独立扛住 v4 的校验：迁移链（严格）拒绝的那些旧形状在这里按字段归一
  // （system 消息的 source、tool/result 的消息形状、自造事件类型的 ignorable 信封）。
  repairRequestHeaders(preserved);
  normalizeToCurrentShape(preserved);
  return {
    meta: { ...rowToMeta(row), version: SESSION_FORMAT_VERSION },

    inheritedEventCount: Math.min(row.fSeedLength ?? 0, preserved.length),
    events: preserved,
    ...(tornFrom !== undefined ? { tornFrom } : {}),
  };
}

export type { SessionId };
