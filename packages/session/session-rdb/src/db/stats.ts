import { E, sum, type Database, type OperandInput } from "@morlay/rdbkit";
import type {
  SessionCountBucket,
  SessionListRowsPage,
  SessionListRowsQuery,
  SessionUsageBucket,
} from "../backend.ts";
import { eventUsage, events, sessionEvents, sessions } from "../entities/index.ts";
import type { StorageRepository } from "../storage-takeover/types.ts";
import {
  deleteSessionStats as deleteSessionStatsRows,
  incrementSessionCounts as incrementSessionCountsRows,
  incrementSessionUsage as incrementSessionUsageRows,
  listSessionRows as listSessionRowsQuery,
  rebuildSessionStats as rebuildSessionStatsRows,
  refreshEventUsageFlags as refreshEventUsageFlagsRows,
  usageActivityScope,
  usageBuckets,
  usageSessionCounts,
  usageSessionTokens,
  usageTokenScope,
} from "../session-ops.ts";
import type { UsageAggregate } from "../usage.ts";
import { COUNTED_EVENT_TYPES } from "../usage.ts";

function asText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

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
    const emptyToken = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, reasoningTokens: 0, totalTokens: 0 };
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
    const sum = (left: typeof emptyToken & typeof emptyActivity, right: typeof emptyToken & typeof emptyActivity) => ({
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

export async function listSessionRows(
  database: Database,
  storage: StorageRepository,
  query?: SessionListRowsQuery,
): Promise<SessionListRowsPage> {
    const needle = query?.query?.trim().toLowerCase() ?? "";
    const index = await storage.listWorkspaceIndex();
    const titleMatches =
      needle === ""
        ? []
        : [
            ...new Set(
              index
                .filter((entry) => entry.title.toLowerCase().includes(needle))
                .flatMap((entry) => entry.sessionIds),
            ),
          ];
    const { items, total } = await listSessionRowsQuery(database, {
      needle,
      titleMatches,
      includeSubagents: query?.includeSubagents === true,
      limit: query?.limit ?? 20,
      offset: query?.offset ?? 0,
    });
    const workspaceOf = new Map<string, string>();
    for (const entry of index) {
      for (const sessionId of entry.sessionIds) {
        if (!workspaceOf.has(sessionId)) workspaceOf.set(sessionId, entry.title);
      }
    }
    return {
      items: items.map((row) => ({
        sessionId: String(row["session_id"]),
        title: asText(row["title"]),
        origin: asText(row["origin"]),
        cwd: asText(row["cwd"]),
        createdAt: Number(row["created_at"]),
        updatedAt: Number(row["updated_at"]),
        archived: Number(row["archived"]) === 1 || row["archived"] === true,
        subagent: row["origin"] === "subagent",
        workspace: workspaceOf.get(String(row["session_id"])) ?? null,
      })),
      total,
    };
  }

export async function incrementSessionUsage(
  database: Database,
  id: string,
  buckets: readonly SessionUsageBucket[],
): Promise<void> {
    await incrementSessionUsageRows(database, id, buckets);
  }

export async function incrementSessionCounts(
  database: Database,
  id: string,
  buckets: readonly SessionCountBucket[],
): Promise<void> {
    await incrementSessionCountsRows(database, id, buckets);
  }

export async function deleteSessionStats(database: Database, id: string): Promise<void> {
    await deleteSessionStatsRows(database, id);
  }

export async function rebuildSessionStats(database: Database, id: string): Promise<void> {
    const links = sessionEvents.table(database);
    const eventsTable = events.table(database);
    const usageTable = eventUsage.table(database);

    // 用量：本会话桥接行 × 用量行，按 (本地日, provider, model) 聚合。
    const usage = links
      .select({
        f_session_id: links.f_session_id,
        f_day: usageTable.f_day,
        f_provider: E.coalesce(usageTable.f_provider, ""),
        f_model: E.coalesce(usageTable.f_model, ""),
        f_input_tokens: sum("f_input_tokens", "t_event_usage"),
        f_output_tokens: sum("f_output_tokens", "t_event_usage"),
        f_cache_read_tokens: sum("f_cache_read_tokens", "t_event_usage"),
        f_reasoning_tokens: sum("f_reasoning_tokens", "t_event_usage"),
        f_total_tokens: sum("f_total_tokens", "t_event_usage"),
      })
      .join(eventUsage, E.eq(usageTable.f_event_id, links.f_event_id))
      .where(E.eq(links.f_session_id, id))
      // 按列分组而不是按 `COALESCE` 表达式：PostgreSQL 的 GROUP BY 匹配按语法树，参数化的表达式
      // 在 SELECT 与 GROUP BY 里是两个不同的 Param 节点，会被判成「不在 GROUP BY 里」。
      .groupBy(links.f_session_id, usageTable.f_day, usageTable.f_provider, usageTable.f_model)
      .toFragment();

    // 活动计数：本会话桥接行 × 事件行，按本地日聚合四项。
    const counts = links
      .select({
        f_session_id: links.f_session_id,
        f_day: E.localDay(eventsTable.f_created_at),
        f_turns: E.countIf(E.eq(eventsTable.f_type, "turn/start")),
        f_steps: E.countIf(E.eq(eventsTable.f_type, "step/start")),
        f_user_inputs: E.countIf(E.eq(eventsTable.f_type, "user/message")),
        f_tool_calls: E.countIf(E.eq(eventsTable.f_type, "tool/call")),
      })
      .join(events, E.eq(eventsTable.f_event_id, links.f_event_id))
      .where(
        E.and(
          E.eq(links.f_session_id, id),
          E.inList(eventsTable.f_type, [...COUNTED_EVENT_TYPES]),
        ),
      )
      .groupBy(links.f_session_id, E.localDay(eventsTable.f_created_at))
      .toFragment();

    await rebuildSessionStatsRows(database, id, { usage, counts });
  }

export async function refreshEventUsageFlags(
  database: Database,
  eventIds: readonly string[],
): Promise<void> {
    const links = sessionEvents.table(database);
    const sessionsTable = sessions.table(database);
    // 相关子查询：外层是被更新的用量行的 `f_event_id`（`UPDATE` 的目标表没有别名，用表名限定）。
    const refersTo = (eventId: OperandInput) => E.eq(links.f_event_id, eventId);
    await refreshEventUsageFlagsRows(
      database,
      eventIds,
      {
        referenced: E.toInt(
          E.exists(
            links
              .select({ one: links.f_event_id })
              .where(refersTo(E.column("f_event_id", "t_event_usage")))
              .toFragment(),
          ),
        ),
        subagent: E.toInt(
          E.exists(
            links
              .select({ one: links.f_event_id })
              .join(sessions, E.eq(sessionsTable.f_session_id, links.f_session_id))
              .where(
                E.and(
                  refersTo(E.column("f_event_id", "t_event_usage")),
                  E.eq(sessionsTable.f_origin, "subagent"),
                ),
              )
              .toFragment(),
          ),
        ),
      },
      400,
    );
  }

