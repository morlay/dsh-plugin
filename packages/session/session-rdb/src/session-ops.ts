import { count, E, sum, type Database, type ExprOperand, type Fragment } from "@morlay/rdbkit";
import type { SessionCountBucket, SessionRow, SessionUsageBucket } from "./backend.ts";
import { localDayKey } from "./usage.ts";
import {
  eventUsage,
  events,
  sessionCounts,
  sessionEvents,
  sessions,
  sessionUsage,
} from "./entities/index.ts";

/**
 * 会话读的小操作：两套 backend 共用（SQLite 传同一连接上的实例，PG 传当前事务的 scoped 实例）。
 * 语义与 Go 的 `session.T` 上的表操作一致——执行面由调用方给，这里不持有连接。
 */

/**
 * upsert 累加：冲突时「列 = 列 + 新值」。
 *
 * 列引用必须带表名：PostgreSQL 的 `ON CONFLICT … DO UPDATE` 里裸列名会与 `excluded` 的同名列歧义
 *（`column reference "f_turns" is ambiguous`），SQLite 两种写法都认。
 */
function accumulated(table: string, column: string): ExprOperand<number> {
  return E.add(E.column(column, table), E.excluded(column));
}

/** 会话行的 head 指针（不存在时 fail loud）。 */
export async function readHead(
  rdb: Database,
  id: string,
): Promise<Pick<SessionRow, "fHeadEventId" | "fHeadSequence">> {
  const table = sessions.table(rdb);
  for await (const row of table
    .select({ fHeadEventId: table.f_head_event_id, fHeadSequence: table.f_head_sequence })
    .where(E.eq(table.f_session_id, id))) {
    return row;
  }
  throw new Error(`session "${id}" has no materialized row`);
}

/** 会话行的 seed 长度（不存在时 fail loud）。 */
export async function readSeedLength(rdb: Database, id: string): Promise<number | null> {
  const table = sessions.table(rdb);
  for await (const row of table
    .select({ fSeedLength: table.f_seed_length })
    .where(E.eq(table.f_session_id, id))) {
    return row.fSeedLength;
  }
  throw new Error(`session "${id}" has no materialized row`);
}

/** 指定序号上的桥接行（rewind 的边界探测）。 */
export async function readPrevBridge(
  rdb: Database,
  id: string,
  sequence: number,
): Promise<{ fEventId: string; fSequence: number } | undefined> {
  const links = sessionEvents.table(rdb);
  for await (const row of links
    .select({ fEventId: links.f_event_id, fSequence: links.f_sequence })
    .where(E.and(E.eq(links.f_session_id, id), E.eq(links.f_sequence, sequence)))
    .limit(1)) {
    return row;
  }
  return undefined;
}

/** 回收没有任何桥接行的事件行（以及跟着走的用量行），返回回收的事件行数。 */
export async function collectOrphans(rdb: Database): Promise<number> {
  const links = sessionEvents.table(rdb);
  const eventsTable = events.table(rdb);
  const orphans: string[] = [];
  for await (const row of eventsTable
    .select({ id: eventsTable.f_event_id })
    .where(
      E.notInSubquery(eventsTable.f_event_id, links.select({ id: links.f_event_id }).toFragment()),
    )) {
    orphans.push(row.id);
  }
  if (orphans.length === 0) return 0;
  await eventsTable.delete(E.inList(eventsTable.f_event_id, orphans));
  // 用量行跟着事件行走：没有事件行的用量不再计入统计。
  const usageTable = eventUsage.table(rdb);
  await usageTable.delete(
    E.notInSubquery(
      usageTable.f_event_id,
      eventsTable.select({ id: eventsTable.f_event_id }).toFragment(),
    ),
  );
  return orphans.length;
}

/**
 * 重算用量行的两个归属标记（`f_referenced` / `f_subagent`）。
 *
 * 表达式是方言相关的（SQLite 直接用 `EXISTS`，PG 要 `::int`），由调用方给；分批是为了绑定参数上限。
 */
export async function refreshEventUsageFlags(
  rdb: Database,
  eventIds: readonly string[],
  flags: { referenced: ExprOperand; subagent: ExprOperand },
  chunkSize = 400,
): Promise<void> {
  const usage = eventUsage.table(rdb);
  for (let at = 0; at < eventIds.length; at += chunkSize) {
    const chunk = eventIds.slice(at, at + chunkSize);
    await usage.update(
      { f_referenced: flags.referenced, f_subagent: flags.subagent },
      E.inList(usage.f_event_id, chunk),
    );
  }
}

/** 用量旁路累加：同键累加 token，不同键插新行（`ON CONFLICT … DO UPDATE SET 列 = 列 + excluded.列`）。 */
export async function incrementSessionUsage(
  rdb: Database,
  id: string,
  buckets: readonly SessionUsageBucket[],
): Promise<void> {
  if (buckets.length === 0) return;
  const usage = sessionUsage.table(rdb);
  for (const bucket of buckets) {
    await usage.upsertExpr(
      {
        f_session_id: id,
        f_day: bucket.day,
        f_provider: bucket.provider ?? "",
        f_model: bucket.model ?? "",
        f_input_tokens: bucket.inputTokens,
        f_output_tokens: bucket.outputTokens,
        f_cache_read_tokens: bucket.cacheReadTokens,
        f_reasoning_tokens: bucket.reasoningTokens,
        f_total_tokens: bucket.totalTokens,
      },
      ["f_session_id", "f_day", "f_provider", "f_model"],
      {
        f_input_tokens: accumulated(usage.name, "f_input_tokens"),
        f_output_tokens: accumulated(usage.name, "f_output_tokens"),
        f_cache_read_tokens: accumulated(usage.name, "f_cache_read_tokens"),
        f_reasoning_tokens: accumulated(usage.name, "f_reasoning_tokens"),
        f_total_tokens: accumulated(usage.name, "f_total_tokens"),
      },
    );
  }
}

/** 活动计数累加：同键累加，不同键插新行。 */
export async function incrementSessionCounts(
  rdb: Database,
  id: string,
  buckets: readonly SessionCountBucket[],
): Promise<void> {
  if (buckets.length === 0) return;
  const counts = sessionCounts.table(rdb);
  for (const bucket of buckets) {
    await counts.upsertExpr(
      {
        f_session_id: id,
        f_day: bucket.day,
        f_turns: bucket.turns,
        f_steps: bucket.steps,
        f_user_inputs: bucket.userInputs,
        f_tool_calls: bucket.toolCalls,
      },
      ["f_session_id", "f_day"],
      {
        f_turns: accumulated(counts.name, "f_turns"),
        f_steps: accumulated(counts.name, "f_steps"),
        f_user_inputs: accumulated(counts.name, "f_user_inputs"),
        f_tool_calls: accumulated(counts.name, "f_tool_calls"),
      },
    );
  }
}

/** 删掉一个会话的两张统计行（重建与删除路径共用）。 */
export async function deleteSessionStats(rdb: Database, id: string): Promise<void> {
  const usage = sessionUsage.table(rdb);
  await usage.delete(E.eq(usage.f_session_id, id));
  const counts = sessionCounts.table(rdb);
  await counts.delete(E.eq(counts.f_session_id, id));
}

/**
 * 按事件行重算一个会话的两张统计表。
 *
 * 查询源由调用方按表句柄构造（本地日、JSON 提取都是 rdbkit 的表达式）；插入列来自表定义。
 */
export async function rebuildSessionStats(
  rdb: Database,
  id: string,
  selectSql: { usage: Fragment; counts: Fragment },
): Promise<void> {
  await deleteSessionStats(rdb, id);
  await rdb
    .table(sessionUsage)
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
      selectSql.usage,
    );
  await rdb
    .table(sessionCounts)
    .insertFromSelect(
      ["f_session_id", "f_day", "f_turns", "f_steps", "f_user_inputs", "f_tool_calls"],
      selectSql.counts,
    );
}

/** 用量总览的第一段：按「本地日 × 模型 × 是否子代理」聚合 token（只算被引用的用量行）。 */
export async function usageBuckets(
  rdb: Database,
  sinceMs?: number,
): Promise<
  Array<{
    day: string;
    provider: string | null;
    model: string | null;
    subagent: number;
    input_tokens: number | bigint;
    output_tokens: number | bigint;
    cache_read_tokens: number | bigint;
    reasoning_tokens: number | bigint;
    total_tokens: number | bigint;
  }>
> {
  const usage = eventUsage.table(rdb);
  const rows = [];
  for await (const row of usage
    .select({
      day: usage.f_day,
      provider: usage.f_provider,
      model: usage.f_model,
      subagent: usage.f_subagent,
      input_tokens: sum("f_input_tokens"),
      output_tokens: sum("f_output_tokens"),
      cache_read_tokens: sum("f_cache_read_tokens"),
      reasoning_tokens: sum("f_reasoning_tokens"),
      total_tokens: sum("f_total_tokens"),
    })
    .where(
      sinceMs === undefined
        ? E.eq(usage.f_referenced, 1)
        : E.and(E.eq(usage.f_referenced, 1), E.gte(usage.f_created_at, sinceMs)),
    )
    .groupBy("f_day", "f_provider", "f_model", "f_subagent")) {
    rows.push(row);
  }
  return rows;
}

/** 用量总览的第二段：按「是否子代理」聚合 token（人类 / 子代理两个口径）。 */
export async function usageTokenScope(
  rdb: Database,
  sinceMs?: number,
): Promise<
  Array<{
    subagent: number;
    input_tokens: number | bigint;
    output_tokens: number | bigint;
    cache_read_tokens: number | bigint;
    reasoning_tokens: number | bigint;
    total_tokens: number | bigint;
  }>
> {
  const usage = eventUsage.table(rdb);
  const rows = [];
  for await (const row of usage
    .select({
      subagent: usage.f_subagent,
      input_tokens: sum("f_input_tokens"),
      output_tokens: sum("f_output_tokens"),
      cache_read_tokens: sum("f_cache_read_tokens"),
      reasoning_tokens: sum("f_reasoning_tokens"),
      total_tokens: sum("f_total_tokens"),
    })
    .where(
      sinceMs === undefined
        ? E.eq(usage.f_referenced, 1)
        : E.and(E.eq(usage.f_referenced, 1), E.gte(usage.f_created_at, sinceMs)),
    )
    .groupBy("f_subagent")) {
    rows.push(row);
  }
  return rows;
}

/** 用量总览的第四段：按会话聚合 token（带上标题 / 是否子代理 / 是否归档）。 */
export async function usageSessionTokens(
  rdb: Database,
  sinceMs?: number,
): Promise<Array<Record<string, unknown>>> {
  const usage = sessionUsage.table(rdb);
  const sessionsTable = sessions.table(rdb);
  const rows = [];
  for await (const row of usage
    .select({
      session_id: usage.f_session_id,
      title: sessionsTable.f_title,
      subagent: E.toInt(E.eq(sessionsTable.f_origin, "subagent")),
      archived: E.toInt(E.isNotNull(sessionsTable.f_archived_at)),
      input_tokens: sum("f_input_tokens"),
      output_tokens: sum("f_output_tokens"),
      cache_read_tokens: sum("f_cache_read_tokens"),
      reasoning_tokens: sum("f_reasoning_tokens"),
      total_tokens: sum("f_total_tokens"),
    })
    .join(sessions, E.eq(usage.f_session_id, sessionsTable.f_session_id))
    .where(sinceMs === undefined ? E.always() : E.gte(usage.f_day, localDayKey(sinceMs)))
    .groupBy(
      usage.f_session_id,
      sessionsTable.f_title,
      sessionsTable.f_origin,
      sessionsTable.f_archived_at,
    )) {
    rows.push(row);
  }
  return rows;
}

/** 用量总览的第五段：按会话聚合活动计数。 */
export async function usageSessionCounts(
  rdb: Database,
  sinceMs?: number,
): Promise<Array<Record<string, unknown>>> {
  const counts = sessionCounts.table(rdb);
  const rows = [];
  for await (const row of counts
    .select({
      session_id: counts.f_session_id,
      turns: sum("f_turns"),
      steps: sum("f_steps"),
      user_inputs: sum("f_user_inputs"),
      tool_calls: sum("f_tool_calls"),
    })
    .where(sinceMs === undefined ? E.always() : E.gte(counts.f_day, localDayKey(sinceMs)))
    .groupBy("f_session_id")) {
    rows.push(row);
  }
  return rows;
}

/** 用量总览的第三段：按「是否子代理」聚合活动计数（只算有用量行的会话）。 */
export async function usageActivityScope(
  rdb: Database,
  sinceMs?: number,
): Promise<Array<Record<string, unknown>>> {
  const counts = sessionCounts.table(rdb);
  const sessionsTable = sessions.table(rdb);
  const usageSessions = sessionUsage.table(rdb);
  const subagentExpr = E.toInt(E.eq(sessionsTable.f_origin, "subagent"));
  const rows = [];
  for await (const row of counts
    .select({
      subagent: subagentExpr,
      turns: sum("f_turns"),
      steps: sum("f_steps"),
      user_inputs: sum("f_user_inputs"),
      tool_calls: sum("f_tool_calls"),
    })
    .join(sessions, E.eq(counts.f_session_id, sessionsTable.f_session_id))
    .where(
      E.and(
        E.exists(
          usageSessions
            .select({ one: usageSessions.f_session_id })
            .where(E.eq(usageSessions.f_session_id, counts.f_session_id))
            .toFragment(),
        ),
        sinceMs === undefined ? E.always() : E.gte(counts.f_day, localDayKey(sinceMs)),
      ),
    )
    // 按列分组而不是按 `CASE` 表达式：PostgreSQL 的 GROUP BY 匹配按语法树，参数化的表达式
    // 在 SELECT 与 GROUP BY 里是两个不同的 Param 节点，会被判成「不在 GROUP BY 里」。
    .groupBy(sessionsTable.f_origin)) {
    rows.push(row);
  }
  return rows;
}

/** 会话列表的过滤条件（搜索词 + workspace 标题命中的会话 + 是否包含子代理）。 */
export interface SessionListRowsArgs {
  needle: string;
  titleMatches: readonly string[];
  includeSubagents: boolean;
  limit: number;
  offset: number;
}

/**
 * 会话列表：分页返回会话行（含 workspace 标题由调用方补），并给出总数。
 *
 * 搜索是「标题模糊匹配 或 workspace 标题命中的会话 id」，排序用物化列
 * `f_last_event_at`（没有事件的会话回落 createdAt）。
 */
export async function listSessionRows(
  rdb: Database,
  args: SessionListRowsArgs,
): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
  const table = sessions.table(rdb);
  const like = `%${args.needle}%`;
  const search =
    args.needle === "" ? E.always() : E.like(E.lower(E.coalesce(table.f_title, "")), like);
  const titleHit =
    args.titleMatches.length === 0 ? [] : [E.inList(table.f_session_id, args.titleMatches)];
  const where = E.and(
    E.or(search, ...titleHit),
    args.includeSubagents
      ? E.always()
      : // `f_origin` 对人类会话是 NULL：`<>` 会把 NULL 行过滤掉，先 COALESCE 成空串（两方言通用）。
        E.ne(E.coalesce(table.f_origin, ""), "subagent"),
  );
  const items: Array<Record<string, unknown>> = [];
  for await (const row of table
    .select({
      session_id: table.f_session_id,
      title: table.f_title,
      origin: table.f_origin,
      cwd: table.f_cwd,
      created_at: table.f_created_at,
      archived: E.toInt(E.isNotNull(table.f_archived_at)),
      updated_at: E.coalesce(table.f_last_event_at, table.f_created_at),
    })
    .where(where)
    .orderBy(E.column("updated_at"), "desc")
    .orderBy(table.f_session_id)
    .limit(args.limit)
    .offset(args.offset)) {
    items.push(row);
  }
  let total = 0;
  for await (const row of table.select({ n: count() }).where(where)) total = Number(row.n);
  return { items, total };
}
