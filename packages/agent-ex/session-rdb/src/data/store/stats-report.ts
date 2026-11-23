// 用量统计的**读口径**：只读三张派生表，不碰 storage 域，所以家在数据面（backend 直接用它）。
//
// 管理面还有一半（`admin/stats/index.ts` 的会话行列表）：那一段要 workspace 文档（`listWorkspaceIndex`），
// 依赖在上层，留在上层。
import type { Database } from "@morlay/zephyr-rdb";
import {
  usageActivityScope,
  usageBuckets,
  usageSessionCounts,
  usageSessionTokens,
  usageTokenScope,
} from "./session-ops.ts";
import type { UsageAggregate } from "../usage.ts";

/**
 * 一次用量聚合：总量 / 其中子代理 / 人类、按天×模型的桶、按会话的行。
 * @param database - 执行面（两方言通用）。
 * @param sinceMs - 起算时间（省略即全量）。
 * @returns 后端原始聚合结果。
 */
export async function usageReport(database: Database, sinceMs?: number): Promise<UsageAggregate> {
  const buckets = await usageBuckets(database, sinceMs);
  const tokenScope = await usageTokenScope(database, sinceMs);
  const activityScope = await usageActivityScope(database, sinceMs);
  const tokenSessions = await usageSessionTokens(database, sinceMs);
  const activitySessions = await usageSessionCounts(database, sinceMs);

  const toToken = (row: Record<string, unknown>) => ({
    inputTokens: Number(row["input_tokens"] ?? 0),
    outputTokens: Number(row["output_tokens"] ?? 0),
    cacheReadTokens: Number(row["cache_read_tokens"] ?? 0),
    reasoningTokens: Number(row["reasoning_tokens"] ?? 0),
    totalTokens: Number(row["total_tokens"] ?? 0),
  });
  const toActivity = (row: Record<string, unknown>) => ({
    turns: Number(row["turns"] ?? 0),
    steps: Number(row["steps"] ?? 0),
    userInputs: Number(row["user_inputs"] ?? 0),
    toolCalls: Number(row["tool_calls"] ?? 0),
  });
  const emptyToken = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  };
  const emptyActivity = { turns: 0, steps: 0, userInputs: 0, toolCalls: 0 };
  const addToken = (target: ReturnType<typeof toToken>, row: Record<string, unknown>) => {
    const token = toToken(row);
    target.inputTokens += token.inputTokens;
    target.outputTokens += token.outputTokens;
    target.cacheReadTokens += token.cacheReadTokens;
    target.reasoningTokens += token.reasoningTokens;
    target.totalTokens += token.totalTokens;
  };
  const addActivity = (target: ReturnType<typeof toActivity>, row: Record<string, unknown>) => {
    const activity = toActivity(row);
    target.turns += activity.turns;
    target.steps += activity.steps;
    target.userInputs += activity.userInputs;
    target.toolCalls += activity.toolCalls;
  };
  const sum = (
    left: typeof emptyToken & typeof emptyActivity,
    right: typeof emptyToken & typeof emptyActivity,
  ) => ({
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    turns: left.turns + right.turns,
    steps: left.steps + right.steps,
    userInputs: left.userInputs + right.userInputs,
    toolCalls: left.toolCalls + right.toolCalls,
  });

  const human = { ...emptyToken, ...emptyActivity };
  const subagent = { ...emptyToken, ...emptyActivity };
  for (const row of tokenScope) {
    addToken(Number(row.subagent) === 1 ? subagent : human, row);
  }
  for (const row of activityScope) {
    addActivity(Number(row["subagent"]) === 1 ? subagent : human, row);
  }
  const activityBySession = new Map<string, ReturnType<typeof toActivity>>();
  for (const row of activitySessions) {
    activityBySession.set(String(row["session_id"]), toActivity(row));
  }
  return {
    totals: sum(sum({ ...emptyToken, ...emptyActivity }, human), subagent),
    subagent,
    human,
    buckets: buckets.map((row) => ({
      day: String(row.day),
      provider: row.provider,
      model: row.model,
      subagent: Number(row.subagent) === 1,
      ...toToken(row as unknown as Record<string, unknown>),
    })),
    sessions: tokenSessions.map((row) => ({
      sessionId: String(row["session_id"]),
      title: asText(row["title"]),
      subagent: Number(row["subagent"]) === 1 || row["subagent"] === true,
      archived: Number(row["archived"]) === 1 || row["archived"] === true,
      ...toToken(row),
      ...(activityBySession.get(String(row["session_id"])) ?? emptyActivity),
    })),
  };
}

function asText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
