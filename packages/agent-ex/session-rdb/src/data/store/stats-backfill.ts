// 派生统计表的全量回填：表为空时按事件表重算（幂等；迁移删表重建、手动清空后自愈）。
//
// 打开时（见 ../../data/store/open.ts）与整库重建（rebuildAllStats）都走这一条。
import {
  E,
  count,
  sum,
  type Database,
  type OperandInput,
  type Table,
  type TableDef,
} from "@morlay/zephyr-rdb";
import {
  eventUsage,
  events,
  sessionCounts,
  sessionEvents,
  sessions,
  sessionUsage,
} from "../entities/index.ts";
import { COUNTED_EVENT_TYPES } from "../usage.ts";

/** 统计表为空时按事件表全量回填（幂等；迁移删表重建、手动清空后自愈）。 */
export async function backfillUsageTables(database: Database): Promise<void> {
  const links = sessionEvents.table(database);
  const eventsTable = events.table(database);
  const sessionsTable = sessions.table(database);
  const usageTable = eventUsage.table(database);

  if (await isEmpty(database, eventUsage)) {
    const hasUsage = (path: string) => E.isNotNull(E.jsonText(eventsTable.f_data, path));
    const text = (path: string) => E.jsonText(eventsTable.f_data, path);
    const int = (path: string) => E.coalesce(E.jsonInt(eventsTable.f_data, path), 0);
    const usagePaths = (field: string) => [`$.data.usage.${field}`, `$.usage.${field}`] as const;
    const input = usagePaths("inputTokens");
    const output = usagePaths("outputTokens");
    const cacheRead = usagePaths("cacheReadTokens");
    const reasoning = usagePaths("reasoningTokens");
    const total = usagePaths("totalTokens");
    const referenced = (eventId: OperandInput) =>
      E.toInt(
        E.exists(
          links
            .select({ one: links.f_event_id })
            .where(E.eq(links.f_event_id, eventId))
            .toFragment(),
        ),
      );
    const subagent = (eventId: OperandInput) =>
      E.toInt(
        E.exists(
          links
            .select({ one: links.f_event_id })
            .join(sessions, E.eq(sessionsTable.f_session_id, links.f_session_id))
            .where(E.and(E.eq(links.f_event_id, eventId), E.eq(sessionsTable.f_origin, "subagent")))
            .toFragment(),
        ),
      );

    const source = eventsTable
      .select({
        f_event_id: eventsTable.f_event_id,
        f_created_at: eventsTable.f_created_at,
        f_day: E.localDay(eventsTable.f_created_at),
        f_provider: E.coalesce(
          text("$.data.message.source.provider"),
          text("$.message.source.provider"),
        ),
        f_model: E.coalesce(text("$.data.message.source.model"), text("$.message.source.model")),
        f_referenced: referenced(E.column("f_event_id", "t_events")),
        f_subagent: subagent(E.column("f_event_id", "t_events")),
        f_input_tokens: E.coalesce(int(input[0]), int(input[1]), 0),
        f_output_tokens: E.coalesce(int(output[0]), int(output[1]), 0),
        f_cache_read_tokens: E.coalesce(int(cacheRead[0]), int(cacheRead[1]), 0),
        f_reasoning_tokens: E.coalesce(int(reasoning[0]), int(reasoning[1]), 0),
        f_total_tokens: E.coalesce(int(total[0]), int(total[1]), 0),
      })
      .where(
        E.and(
          E.eq(eventsTable.f_type, "assistant/message"),
          E.or(hasUsage("$.data.usage"), hasUsage("$.usage")),
        ),
      )
      .toFragment();

    await usageTable.insertFromSelect(
      [
        "f_event_id",
        "f_created_at",
        "f_day",
        "f_provider",
        "f_model",
        "f_referenced",
        "f_subagent",
        "f_input_tokens",
        "f_output_tokens",
        "f_cache_read_tokens",
        "f_reasoning_tokens",
        "f_total_tokens",
      ],
      source,
      { conflict: ["f_event_id"] },
    );
  }

  if (await isEmpty(database, sessionUsage)) {
    const source = links
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
      // 同上：分组用列，`COALESCE` 只留在投影里。
      .groupBy(links.f_session_id, usageTable.f_day, usageTable.f_provider, usageTable.f_model)
      .toFragment();
    await sessionUsage
      .table(database)
      .insertFromSelect(
        [
          "f_session_id",
          "f_day",
          "f_provider",
          "f_model",
          "f_input_tokens",
          "f_output_tokens",
          "f_cache_read_tokens",
          "f_reasoning_tokens",
          "f_total_tokens",
        ],
        source,
        { conflict: ["f_session_id", "f_day", "f_provider", "f_model"] },
      );
  }

  if (await isEmpty(database, sessionCounts)) {
    const source = links
      .select({
        f_session_id: links.f_session_id,
        f_day: E.localDay(eventsTable.f_created_at),
        f_turns: E.countIf(E.eq(eventsTable.f_type, "turn/start")),
        f_steps: E.countIf(E.eq(eventsTable.f_type, "step/start")),
        f_user_inputs: E.countIf(E.eq(eventsTable.f_type, "user/message")),
        f_tool_calls: E.countIf(E.eq(eventsTable.f_type, "tool/call")),
      })
      .join(events, E.eq(eventsTable.f_event_id, links.f_event_id))
      .where(E.inList(eventsTable.f_type, [...COUNTED_EVENT_TYPES]))
      .groupBy(links.f_session_id, E.localDay(eventsTable.f_created_at))
      .toFragment();
    await sessionCounts
      .table(database)
      .insertFromSelect(
        ["f_session_id", "f_day", "f_turns", "f_steps", "f_user_inputs", "f_tool_calls"],
        source,
        { conflict: ["f_session_id", "f_day"] },
      );
  }
}

async function isEmpty<T extends TableDef>(
  database: Database,
  definition: Table<T>,
): Promise<boolean> {
  for await (const row of definition.table(database).select({ n: count() })) {
    // PostgreSQL 的 COUNT 返回 int8 → BigInt，`0n === 0` 是 false，必须显式转。
    return Number(row.n) === 0;
  }
  return true;
}
