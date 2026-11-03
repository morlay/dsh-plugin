import type { SessionEvent } from "@deepseek-ai/dsh-session";
import type { SessionCountBucket, SessionUsageBucket } from "./backend.ts";
import type { EventUsageRow } from "./log/usage-row.ts";
import { COUNTED_EVENT_TYPES, addActivityCount, localDayKey } from "./usage.ts";

// 一批事件折成活动计数的桶：只数四种类型，按本地日聚合成四项。
export function sessionCountBuckets(events: readonly SessionEvent[]): SessionCountBucket[] {
  const counted = new Map<string, SessionCountBucket>();
  for (const event of events) {
    if (!(COUNTED_EVENT_TYPES as readonly string[]).includes(event.type)) continue;
    const day = localDayKey(event.time);
    const bucket = counted.get(day) ?? { day, turns: 0, steps: 0, userInputs: 0, toolCalls: 0 };
    addActivityCount(bucket, event.type, 1);
    counted.set(day, bucket);
  }
  return [...counted.values()];
}

// 一批用量行折成 token 桶：按「本地日 × 模型」聚合（模型未知落空串，与表口径一致）。
export function sessionUsageBuckets(usageRows: readonly EventUsageRow[]): SessionUsageBucket[] {
  const counted = new Map<string, SessionUsageBucket>();
  for (const row of usageRows) {
    const provider = row.fProvider ?? "";
    const model = row.fModel ?? "";
    const key = `${row.fDay}#${provider}#${model}`;
    const bucket = counted.get(key) ?? {
      day: row.fDay,
      provider,
      model,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
    };
    bucket.inputTokens += row.fInputTokens;
    bucket.outputTokens += row.fOutputTokens;
    bucket.cacheReadTokens += row.fCacheReadTokens;
    bucket.reasoningTokens += row.fReasoningTokens;
    bucket.totalTokens += row.fTotalTokens;
    counted.set(key, bucket);
  }
  return [...counted.values()];
}
