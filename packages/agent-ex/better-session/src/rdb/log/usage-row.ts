import { localDayKey } from "../usage.ts";

export interface EventUsageRow {
  fEventId: string;
  fCreatedAt: number;
  fDay: string;
  fProvider: string | null;
  fModel: string | null;
  fReferenced: number;
  fSubagent: number;
  fInputTokens: number;
  fOutputTokens: number;
  fCacheReadTokens: number;
  fReasoningTokens: number;
  fTotalTokens: number;
}

function numericField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function textField(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

// 一条事件行的用量（只有带 `usage` 的 `assistant/message` 才有；没有用量时为 undefined）：写路径据此记录
// `t_event_usage`，统计因此不必逐行解析 JSON，两种 `f_data` 结构（带信封 / 老格式）都认。读侧维度一起物化：
// 本地日由事件时间算，`f_referenced` 直接 1（这一批事件行与桥接行同事务），`f_subagent` 取写入它的会话是否子代理。
export function usageRowOf(
  event: {
    fEventId: string;
    fCreatedAt: number;
    fType: string;
    fData: string;
  },
  subagent: boolean,
): EventUsageRow | undefined {
  if (event.fType !== "assistant/message") return undefined;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(event.fData) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const envelope = (parsed["data"] ?? parsed) as Record<string, unknown>;
  const usage = envelope["usage"];
  if (typeof usage !== "object" || usage === null) return undefined;
  const source = (envelope["message"] as { source?: Record<string, unknown> } | undefined)?.source;
  const row: EventUsageRow = {
    fEventId: event.fEventId,
    fCreatedAt: event.fCreatedAt,
    fDay: localDayKey(event.fCreatedAt),
    fProvider: textField(source?.["provider"]),
    fModel: textField(source?.["model"]),
    fReferenced: 1,
    fSubagent: subagent ? 1 : 0,
    fInputTokens: numericField((usage as Record<string, unknown>)["inputTokens"]),
    fOutputTokens: numericField((usage as Record<string, unknown>)["outputTokens"]),
    fCacheReadTokens: numericField((usage as Record<string, unknown>)["cacheReadTokens"]),
    fReasoningTokens: numericField((usage as Record<string, unknown>)["reasoningTokens"]),
    fTotalTokens: numericField((usage as Record<string, unknown>)["totalTokens"]),
  };
  return row;
}
