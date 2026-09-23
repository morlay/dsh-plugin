import type { Context } from "@deepseek-ai/cordis";
import type { SessionPersistenceRdb } from "./index.ts";

export const SESSION_USAGE_PATH = "/api/session.usage";

/**
 * 时间范围的语义键：`all` 不限；`day` / `week` 是**本地自然日 / 自然周**（周一起算）；
 * `7d` / `30d` / `90d` 是**最近 N 个自然日**（含今天）。
 */
export type UsageRangeKey = "all" | "day" | "week" | "7d" | "30d" | "90d";

const ROLLING_DAYS: Record<"7d" | "30d" | "90d", number> = { "7d": 7, "30d": 30, "90d": 90 };

function localDayStart(now: number): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
}

/**
 * 范围起点（含），不限时为 undefined。**所有起点都对齐到 host 本地时区的零点**——`day` / `week` 是
 * 今天 / 本周一的零点，`7d` / `30d` / `90d` 是「今天零点往前 N-1 天」（含今天共 N 个自然日）。
 * 对齐的意义：事件级表按毫秒过滤、会话汇总表按本地日过滤，两者因此严格等价。
 * @param range - 语义键。
 * @param now - 当前时刻。
 * @returns 起点毫秒时间戳，或 undefined。
 */
export function resolveUsageSince(range: UsageRangeKey, now: number): number | undefined {
  switch (range) {
    case "all":
      return undefined;
    case "day":
      return localDayStart(now).getTime();
    case "week": {
      const start = localDayStart(now);
      // getDay(): 0 = 周日；换算成「距离本周一几天」。
      start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
      return start.getTime();
    }
    default: {
      // 用日历日期减（不是减 N × 24h）：跨夏令时切换时「N-1 天前的零点」才是本地零点。
      const start = localDayStart(now);
      start.setDate(start.getDate() - (ROLLING_DAYS[range] - 1));
      return start.getTime();
    }
  }
}

function parseUsageRange(value: unknown): UsageRangeKey {
  return value === "day" || value === "week" || value === "7d" || value === "30d" || value === "90d"
    ? value
    : "all";
}

/** 一段 token 用量（字段直接取事件里模型报的 usage）。 */
export interface UsageTokenTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

/**
 * 活动计数：与 token 用量同一时间范围、同一去重口径（只算被会话引用的事件行），
 * 按事件类型数出来——「轮次 / 步骤 / 用户输入 / 工具调用」比「事件行数」有信息量。
 */
export interface UsageActivityTotals {
  turns: number;
  steps: number;
  userInputs: number;
  toolCalls: number;
}

/** 总量与按会话行用的一整套指标（token + 活动）。 */
export interface UsageTotals extends UsageTokenTotals, UsageActivityTotals {}

/**
 * 一天 × 一个模型 × 是否子代理 的用量桶：总览、按天、按模型都由它折叠。
 * 只有 token 用量——活动计数没有模型归属（一个轮次可能跨模型），挂在总量与按会话行上。
 */
export interface UsageBucket extends UsageTokenTotals {
  day: string;
  provider: string | null;
  model: string | null;
  subagent: boolean;
}

/** 一条会话的用量行。 */
export interface UsageSessionRow extends UsageTotals {
  sessionId: string;
  title: string | null;
  subagent: boolean;
  archived: boolean;
}

/** 后端的原始聚合结果（总量 / 其中子代理 / 人类、按天×模型的桶、按会话的行）。 */
export interface UsageAggregate {
  totals: UsageTotals;
  subagent: UsageTotals;
  human: UsageTotals;
  buckets: UsageBucket[];
  sessions: UsageSessionRow[];
}

/** 一次统计请求的完整回报。 */
export type SessionUsageReport = UsageAggregate;

/** 计入活动计数的事件类型（轮次 / 步骤 / 用户输入 / 工具调用）。 */
export const COUNTED_EVENT_TYPES = [
  "turn/start",
  "step/start",
  "user/message",
  "tool/call",
] as const;

/** 按事件类型把计数累加到活动指标上（表里按类型存，读的时候折成四项）。 */
export function addActivityCount(
  target: UsageActivityTotals,
  type: string,
  count: number,
): UsageActivityTotals {
  switch (type) {
    case "turn/start":
      target.turns += count;
      return target;
    case "step/start":
      target.steps += count;
      return target;
    case "user/message":
      target.userInputs += count;
      return target;
    case "tool/call":
      target.toolCalls += count;
      return target;
    default:
      return target;
  }
}

/** 毫秒时间戳 → host 本地日（`YYYY-MM-DD`，与 SQL 的 localtime 口径一致）。 */
export function localDayKey(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function emptyTotals(): UsageTotals {
  return {
    turns: 0,
    steps: 0,
    userInputs: 0,
    toolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  };
}

export function addTokenTotals(target: UsageTokenTotals, row: UsageTokenTotals): UsageTokenTotals {
  target.inputTokens += row.inputTokens;
  target.outputTokens += row.outputTokens;
  target.cacheReadTokens += row.cacheReadTokens;
  target.reasoningTokens += row.reasoningTokens;
  target.totalTokens += row.totalTokens;
  return target;
}

export function addActivityTotals(
  target: UsageActivityTotals,
  row: UsageActivityTotals,
): UsageActivityTotals {
  target.turns += row.turns;
  target.steps += row.steps;
  target.userInputs += row.userInputs;
  target.toolCalls += row.toolCalls;
  return target;
}

/** 把一行的整套指标累加进目标（后端合并「是否子代理」两组时用）。 */
export function addTotals(target: UsageTotals, row: UsageTotals): UsageTotals {
  addActivityTotals(target, row);
  addTokenTotals(target, row);
  return target;
}

/**
 * 用量统计通道：一次请求回报总览（含 subagent 拆分）、按天 × 模型的桶与按会话的行。
 * 聚合只算被会话引用的事件行——fork 共享行因此只计一次，已删会话留下的孤儿行不计。
 */
export function registerSessionUsage(ctx: Context, persistence: SessionPersistenceRdb): void {
  ctx.inject(["webServer", "connection"] as const, (webCtx) => {
    const webServer = webCtx.webServer as unknown as {
      register(route: {
        kind: "exact";
        path: string;
        handler: (
          req: import("node:http").IncomingMessage,
          res: import("node:http").ServerResponse,
        ) => void | Promise<void>;
      }): () => void;
    };
    const connection = webCtx.get("connection") as unknown as {
      requestRejection(request: {
        headers: import("node:http").IncomingHttpHeaders;
      }): number | undefined;
    };
    return webCtx.effect(
      () =>
        webServer.register({
          kind: "exact",
          path: SESSION_USAGE_PATH,
          handler: async (req, res) => {
            const rejection = connection.requestRejection(req);
            if (rejection !== undefined) {
              res.writeHead(rejection);
              res.end(rejection === 401 ? "unauthorized" : "forbidden");
              return;
            }
            if (req.method !== "POST") {
              res.writeHead(405, { "content-type": "application/json" });
              res.end(JSON.stringify({ error: "method not allowed" }));
              return;
            }
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk as Buffer);
            const raw = Buffer.concat(chunks).toString("utf8");
            let envelope: { range?: unknown } = {};
            if (raw !== "") {
              try {
                envelope = JSON.parse(raw) as { range?: unknown };
              } catch {
                res.writeHead(400, { "content-type": "application/json" });
                res.end(JSON.stringify({ error: "request body is not JSON" }));
                return;
              }
            }
            try {
              const report = await persistence.usageReport(
                resolveUsageSince(parseUsageRange(envelope.range), Date.now()),
              );
              res.writeHead(200, { "content-type": "application/json" });
              res.end(JSON.stringify(report));
            } catch (error: unknown) {
              res.writeHead(500, { "content-type": "application/json" });
              res.end(
                JSON.stringify({
                  error: error instanceof Error ? error.message : "usage report failed",
                }),
              );
            }
          },
        }),
      `session-rdb: ${SESSION_USAGE_PATH} route`,
    );
  });
}
