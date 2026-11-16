// 派生统计表与事件行的一致性校验：**只读、只报告、不自动修**。
//
// 三张派生表（t_event_usage / t_session_usage / t_session_counts）是旁路累加得来的：累加失败只落一条
// warn，删除会话之后的重算失败也只落一条 warn。于是「账对不上」在库里是静默的。这里把它变成一次可判定的读：
// 谁对不上、期望多少、实际多少；修不修由调用方决定（重算归 rebuildAllStats / rebuildSessionStats）。
//
// 口径只证明「该有的都在」：撤回与覆盖导入不退统计，所以统计**大于**重算的那部分是历史消耗，不是漂移；
// 小于重算、或行根本不存在，才是漏记。
import { count, E, sum, type Database, type Table, type TableDef } from "@morlay/zephyr-rdb";
import {
  eventUsage,
  events,
  sessionCounts,
  sessionEvents,
  sessions,
  sessionUsage,
} from "../data/entities/index.ts";
import { COUNTED_EVENT_TYPES } from "../data/usage.ts";

export type ConsistencyIssueKind =
  // 用量行没有事件行（collectOrphans 会删的形态）。
  | "orphan-usage-row"
  // 会话的 token 合计比「按桥接行重算」少：旁路累加漏记。
  | "session-usage-missing"
  // 会话的四项计数合计比「按桥接行重算」少：旁路累加漏记。
  | "session-counts-missing"
  // 用量行的归属标记漏了：有桥接行（或子代理会话）指向它，但标记仍是 0。
  | "usage-flag-missing"
  // f_seed_length 大于日志长度：这份会话按继承前缀读不出来。
  | "seed-length-drift";

/** 一条不一致：subject 指会话 id 或事件 id，detail 给期望与实际的差。 */
export interface ConsistencyIssue {
  readonly kind: ConsistencyIssueKind;
  readonly subject: string;
  readonly detail: string;
}

/** 一次校验的报告：扫过多少行 + 发现哪些不一致；ok 只是 issues 为空。 */
export interface ConsistencyReport {
  readonly ok: boolean;
  readonly checked: {
    readonly sessions: number;
    readonly events: number;
    readonly bridges: number;
    readonly usageRows: number;
    readonly countRows: number;
  };
  readonly issues: readonly ConsistencyIssue[];
}

// 每种最多报几条：报告要可读，漂移规模看「有没有」而不是样本条数。
const SAMPLE_LIMIT = 10;

/**
 * 校验派生统计表与事件行是否对得上（只读：不写任何行、不重算）。
 * @param database - 执行面（两方言通用）。
 * @returns 扫过的行数与不一致清单。
 */
export async function checkConsistency(database: Database): Promise<ConsistencyReport> {
  const issues: ConsistencyIssue[] = [];
  const checked = {
    sessions: await countRows(database, sessions),
    events: await countRows(database, events),
    bridges: await countRows(database, sessionEvents),
    usageRows: await countRows(database, eventUsage),
    countRows: await countRows(database, sessionCounts),
  };
  await checkSessionUsage(database, issues);
  await checkSessionCounts(database, issues);
  await checkOrphanUsageRows(database, issues);
  await checkUsageFlags(database, issues);
  await checkSeedLength(database, issues);
  return { ok: issues.length === 0, checked, issues };
}

// —— 重算结果的观测面 ——

/** 删除 / 回收之后要重算的两步（派生状态的两个引用面）。 */
export type DerivationRepairStep = "session-stats" | "usage-flags";

/** 一步重算失败：步骤名 + 原因。 */
export interface DerivationRepairFailure {
  readonly step: DerivationRepairStep;
  readonly message: string;
}

/** 重算结果：两步都成功才 repaired。 */
export interface DerivationRepairReport {
  readonly repaired: boolean;
  readonly failures: readonly DerivationRepairFailure[];
}

/**
 * 跑一遍派生状态的重算步骤，把失败**报出来**而不是只落一条日志。
 *
 * 删除会话是已经提交的动作（会话行与桥接行都删了）：重算失败不能回滚它，但也不能静默——
 * 失败留下的漂移正是 {@link checkConsistency} 能读出来的那几种，调用方据此提示 / 重试。
 * @param steps - 要跑的步骤（顺序执行；每步一个 thunk，失败路径可以单独验证）。
 * @returns 两步的结果；任一失败即 repaired: false。
 */
export async function repairDerivations(
  steps: ReadonlyArray<{ readonly step: DerivationRepairStep; readonly run: () => Promise<void> }>,
): Promise<DerivationRepairReport> {
  const failures: DerivationRepairFailure[] = [];
  for (const { step, run } of steps) {
    try {
      await run();
    } catch (error: unknown) {
      failures.push({
        step,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { repaired: failures.length === 0, failures };
}

// —— 各项检查 ——

interface TokenTotals {
  input: number;
  output: number;
  cacheRead: number;
  reasoning: number;
  total: number;
}

interface CountTotals {
  turns: number;
  steps: number;
  userInputs: number;
  toolCalls: number;
}

const TOKEN_COLUMNS: ReadonlyArray<readonly [column: string, field: keyof TokenTotals]> = [
  ["f_input_tokens", "input"],
  ["f_output_tokens", "output"],
  ["f_cache_read_tokens", "cacheRead"],
  ["f_reasoning_tokens", "reasoning"],
  ["f_total_tokens", "total"],
];

const COUNT_COLUMNS: ReadonlyArray<readonly [column: string, field: keyof CountTotals]> = [
  ["f_turns", "turns"],
  ["f_steps", "steps"],
  ["f_user_inputs", "userInputs"],
  ["f_tool_calls", "toolCalls"],
];

const EMPTY_TOKENS: TokenTotals = { input: 0, output: 0, cacheRead: 0, reasoning: 0, total: 0 };

const EMPTY_COUNTS: CountTotals = { turns: 0, steps: 0, userInputs: 0, toolCalls: 0 };

function toTokenTotals(row: object): TokenTotals {
  const totals = { ...EMPTY_TOKENS };
  for (const [column, field] of TOKEN_COLUMNS)
    totals[field] = Number(Reflect.get(row, column) ?? 0);
  return totals;
}

function toCountTotals(row: object): CountTotals {
  const totals = { ...EMPTY_COUNTS };
  for (const [column, field] of COUNT_COLUMNS)
    totals[field] = Number(Reflect.get(row, column) ?? 0);
  return totals;
}

// 「少了」的差：逐列只报期望大于实际的那些（多出来的是历史消耗，不是漂移）。
function missingOf<T>(
  expected: T,
  actual: T,
  columns: ReadonlyArray<readonly [column: string, field: keyof T]>,
): string | undefined {
  const parts: string[] = [];
  for (const [column, field] of columns) {
    const want = Number(expected[field]);
    const got = Number(actual[field]);
    if (want > got) parts.push(column + " 期望 " + String(want) + "，实际 " + String(got));
  }
  return parts.length === 0 ? undefined : parts.join("；");
}

async function checkSessionUsage(database: Database, issues: ConsistencyIssue[]): Promise<void> {
  const expected = await sessionUsageFromEvents(database);
  const actual = await sessionUsageFromTable(database);
  for (const [sessionId, want] of expected) {
    const detail = missingOf(want, actual.get(sessionId) ?? EMPTY_TOKENS, TOKEN_COLUMNS);
    if (detail !== undefined) {
      issues.push({ kind: "session-usage-missing", subject: sessionId, detail });
    }
  }
}

async function checkSessionCounts(database: Database, issues: ConsistencyIssue[]): Promise<void> {
  const expected = await sessionCountsFromEvents(database);
  const actual = await sessionCountsFromTable(database);
  for (const [sessionId, want] of expected) {
    const detail = missingOf(want, actual.get(sessionId) ?? EMPTY_COUNTS, COUNT_COLUMNS);
    if (detail !== undefined) {
      issues.push({ kind: "session-counts-missing", subject: sessionId, detail });
    }
  }
}

async function checkOrphanUsageRows(database: Database, issues: ConsistencyIssue[]): Promise<void> {
  const usage = eventUsage.table(database);
  const eventsTable = events.table(database);
  for await (const row of usage
    .select({ f_event_id: usage.f_event_id })
    .where(
      E.notInSubquery(
        usage.f_event_id,
        eventsTable.select({ id: eventsTable.f_event_id }).toFragment(),
      ),
    )
    .limit(SAMPLE_LIMIT)) {
    issues.push({
      kind: "orphan-usage-row",
      subject: String(row.f_event_id),
      detail: "用量行没有对应的事件行（孤儿统计，collectOrphans 会清掉）",
    });
  }
}

async function checkUsageFlags(database: Database, issues: ConsistencyIssue[]): Promise<void> {
  const usage = eventUsage.table(database);
  const links = sessionEvents.table(database);
  const sessionsTable = sessions.table(database);
  const refersTo = E.eq(links.f_event_id, usage.f_event_id);

  for await (const row of usage
    .select({ f_event_id: usage.f_event_id })
    .where(
      E.and(
        E.eq(usage.f_referenced, 0),
        E.exists(links.select({ one: links.f_event_id }).where(refersTo).toFragment()),
      ),
    )
    .limit(SAMPLE_LIMIT)) {
    issues.push({
      kind: "usage-flag-missing",
      subject: String(row.f_event_id),
      detail: "f_referenced=0，但有会话的桥接行指向它（这份用量没进总览）",
    });
  }

  for await (const row of usage
    .select({ f_event_id: usage.f_event_id })
    .where(
      E.and(
        E.eq(usage.f_subagent, 0),
        E.exists(
          links
            .select({ one: links.f_event_id })
            .join(sessions, E.eq(sessionsTable.f_session_id, links.f_session_id))
            .where(E.and(refersTo, E.eq(sessionsTable.f_origin, "subagent")))
            .toFragment(),
        ),
      ),
    )
    .limit(SAMPLE_LIMIT)) {
    issues.push({
      kind: "usage-flag-missing",
      subject: String(row.f_event_id),
      detail: "f_subagent=0，但有子代理会话的桥接行指向它（子代理那份账没记上）",
    });
  }
}

async function checkSeedLength(database: Database, issues: ConsistencyIssue[]): Promise<void> {
  const sessionsTable = sessions.table(database);
  const links = sessionEvents.table(database);
  const lengths = new Map<string, number>();
  for await (const row of links
    .select({ f_session_id: links.f_session_id, n: count() })
    .groupBy(links.f_session_id)) {
    lengths.set(String(row.f_session_id), Number(row.n));
  }
  for await (const row of sessionsTable
    .select({
      f_session_id: sessionsTable.f_session_id,
      f_seed_length: sessionsTable.f_seed_length,
    })
    .where(E.isNotNull(sessionsTable.f_seed_length))) {
    const seed = Number(row.f_seed_length);
    const logLength = lengths.get(String(row.f_session_id)) ?? 0;
    if (seed > logLength) {
      issues.push({
        kind: "seed-length-drift",
        subject: String(row.f_session_id),
        detail:
          "f_seed_length=" +
          String(seed) +
          " 大于日志长度 " +
          String(logLength) +
          "（按继承前缀读不出来）",
      });
    }
  }
}

// —— 两侧的聚合查询：统计表一侧 / 按桥接行重算一侧 ——

// 会话的 token 合计（统计表一侧）。
async function sessionUsageFromTable(database: Database): Promise<Map<string, TokenTotals>> {
  const table = sessionUsage.table(database);
  const totals = new Map<string, TokenTotals>();
  for await (const row of table
    .select({
      f_session_id: table.f_session_id,
      f_input_tokens: sum("f_input_tokens"),
      f_output_tokens: sum("f_output_tokens"),
      f_cache_read_tokens: sum("f_cache_read_tokens"),
      f_reasoning_tokens: sum("f_reasoning_tokens"),
      f_total_tokens: sum("f_total_tokens"),
    })
    .groupBy("f_session_id")) {
    totals.set(String(row.f_session_id), toTokenTotals(row));
  }
  return totals;
}

// 会话的 token 合计（按桥接行 × 用量行重算）：继承前缀那一段不算——它不来自本会话的累加。
async function sessionUsageFromEvents(database: Database): Promise<Map<string, TokenTotals>> {
  const links = sessionEvents.table(database);
  const usage = eventUsage.table(database);
  const sessionsTable = sessions.table(database);
  const totals = new Map<string, TokenTotals>();
  for await (const row of links
    .select({
      f_session_id: links.f_session_id,
      f_input_tokens: sum("f_input_tokens", "t_event_usage"),
      f_output_tokens: sum("f_output_tokens", "t_event_usage"),
      f_cache_read_tokens: sum("f_cache_read_tokens", "t_event_usage"),
      f_reasoning_tokens: sum("f_reasoning_tokens", "t_event_usage"),
      f_total_tokens: sum("f_total_tokens", "t_event_usage"),
    })
    .join(eventUsage, E.eq(usage.f_event_id, links.f_event_id))
    .join(sessions, E.eq(sessionsTable.f_session_id, links.f_session_id))
    .where(
      E.or(
        E.isNull(sessionsTable.f_seed_length),
        E.gte(links.f_sequence, sessionsTable.f_seed_length),
      ),
    )
    .groupBy(links.f_session_id)) {
    totals.set(String(row.f_session_id), toTokenTotals(row));
  }
  return totals;
}

// 会话的四项计数（统计表一侧）。
async function sessionCountsFromTable(database: Database): Promise<Map<string, CountTotals>> {
  const table = sessionCounts.table(database);
  const totals = new Map<string, CountTotals>();
  for await (const row of table
    .select({
      f_session_id: table.f_session_id,
      f_turns: sum("f_turns"),
      f_steps: sum("f_steps"),
      f_user_inputs: sum("f_user_inputs"),
      f_tool_calls: sum("f_tool_calls"),
    })
    .groupBy("f_session_id")) {
    totals.set(String(row.f_session_id), toCountTotals(row));
  }
  return totals;
}

// 会话的四项计数（按桥接行 × 事件行重算）：同样只看继承前缀之后的那一段。
async function sessionCountsFromEvents(database: Database): Promise<Map<string, CountTotals>> {
  const links = sessionEvents.table(database);
  const eventsTable = events.table(database);
  const sessionsTable = sessions.table(database);
  const totals = new Map<string, CountTotals>();
  for await (const row of links
    .select({
      f_session_id: links.f_session_id,
      f_turns: E.countIf(E.eq(eventsTable.f_type, "turn/start")),
      f_steps: E.countIf(E.eq(eventsTable.f_type, "step/start")),
      f_user_inputs: E.countIf(E.eq(eventsTable.f_type, "user/message")),
      f_tool_calls: E.countIf(E.eq(eventsTable.f_type, "tool/call")),
    })
    .join(events, E.eq(eventsTable.f_event_id, links.f_event_id))
    .join(sessions, E.eq(sessionsTable.f_session_id, links.f_session_id))
    .where(
      E.and(
        E.inList(eventsTable.f_type, [...COUNTED_EVENT_TYPES]),
        E.or(
          E.isNull(sessionsTable.f_seed_length),
          E.gte(links.f_sequence, sessionsTable.f_seed_length),
        ),
      ),
    )
    .groupBy(links.f_session_id)) {
    totals.set(String(row.f_session_id), toCountTotals(row));
  }
  return totals;
}

async function countRows<T extends TableDef>(
  database: Database,
  definition: Table<T>,
): Promise<number> {
  for await (const row of definition.table(database).select({ n: count() })) {
    // PostgreSQL 的 COUNT 返回 int8 → BigInt，必须先转。
    return Number(row.n);
  }
  return 0;
}
