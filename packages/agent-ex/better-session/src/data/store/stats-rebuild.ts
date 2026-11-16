// 派生统计的写入与重建：旁路累加、按会话重算、引用标记刷新、整库清空重建。
//
// 失败只 warn（统计可丢、可重建）；重建走「删了再回填」这条与打开时自愈相同的路径。
import { E, count, sum, type Database, type OperandInput } from "@morlay/zephyr-rdb";
import type { SessionCountBucket, SessionUsageBucket } from "../backend.ts";
import {
  eventUsage,
  events,
  sessionCounts,
  sessionEvents,
  sessions,
  sessionUsage,
} from "../entities/index.ts";
import {
  deleteSessionStats as deleteSessionStatsRows,
  incrementSessionCounts as incrementSessionCountsRows,
  incrementSessionUsage as incrementSessionUsageRows,
  rebuildSessionStats as rebuildSessionStatsRows,
  refreshEventUsageFlags as refreshEventUsageFlagsRows,
} from "./session-ops.ts";
import { COUNTED_EVENT_TYPES } from "../usage.ts";
import { backfillUsageTables } from "./stats-backfill.ts";

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
      E.and(E.eq(links.f_session_id, id), E.inList(eventsTable.f_type, [...COUNTED_EVENT_TYPES])),
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

/**
 * 整理数据的一步：三张派生统计表**清空后全量重算**。
 *
 * 这三张表本来就是可销毁重建的派生数据（见 ADR-统计衍生表物化归属与汇总），所以重算走「删了再回填」
 * 这条与打开时自愈相同的路径，不逐会话补差。
 * @param database - 执行面。
 * @returns 重建涉及的会话数。
 */
export async function rebuildAllStats(database: Database): Promise<number> {
  await sessionUsage.table(database).delete();
  await sessionCounts.table(database).delete();
  await eventUsage.table(database).delete();
  await backfillUsageTables(database);
  let total = 0;
  for await (const row of sessions.table(database).select({ n: count() })) {
    total = Number(row.n);
  }
  return total;
}
