// 统计视图：时间范围过滤 + 二层维度切换（总览 / 按模型 / 按会话）。
//
// 一次全库聚合在宿主侧算（换范围才重新请求），维度切换本地折叠；失败用统一的反馈面给原因与重试。
import { Row, Stack, Tag, Text } from "@morlay/zephyr-ui";
import type {
  SessionUsageBucket,
  SessionUsageRange,
  SessionUsageSessionRow,
  SessionUsageTotals,
  SessionUsageValue,
} from "@morlay/session-rdb/endpoint";
import type { ReactNode } from "react";
import { Feedback } from "../shared/feedback.tsx";
import { FilterChip } from "./filter-chip.tsx";
import frameCss from "./conversation-manager-page.module.css";
import { formatCount, formatPercent, formatTokens } from "./format.ts";
import type { ConversationManagerTranslate } from "./locales.ts";

// 统计视图按会话列出时的行数上限。
const USAGE_SESSION_ROWS = 20;

// 统计视图的二层维度。
export type UsageTab = "overview" | "models" | "sessions";

// 时间范围选项：默认本日，其后是本周（周一起算）与最近 N 天，「全部」放在最后。
const USAGE_RANGES: readonly SessionUsageRange[] = ["day", "week", "7d", "30d", "90d", "all"];

// 范围按钮的文案。
function rangeLabel(range: SessionUsageRange, t: ConversationManagerTranslate): string {
  switch (range) {
    case "all":
      return t("usage.range.all");
    case "day":
      return t("usage.range.day");
    case "week":
      return t("usage.range.week");
    case "7d":
      return t("usage.range.days", { n: 7 });
    case "30d":
      return t("usage.range.days", { n: 30 });
    case "90d":
      return t("usage.range.days", { n: 90 });
  }
}

// 一个用量单项：标签在上、值在下；单项之间横向排布。
interface UsageMetric {
  key: string;
  label: string;
  // 原始值：token 数、计数，或百分点（`percent` 项）。
  value: number;
  kind: "tokens" | "count" | "percent";
}

// 缓存命中率（百分点）：缓存输入占总输入（含缓存）的比例。
function cacheHitPercent(totals: SessionUsageTotals): number {
  const total = totals.inputTokens + totals.cacheReadTokens;
  if (total <= 0) return 0;
  return (totals.cacheReadTokens / total) * 100;
}

// 显示口径的单项：输入（含缓存）、缓存输入、命中率、输出、推理，以及活动计数（没有合计项）。
// 活动计数在按模型的行上不显示（事件没有模型归属）。
function usageMetrics(
  totals: SessionUsageTotals,
  t: ConversationManagerTranslate,
  options: { withActivity?: boolean } = {},
): UsageMetric[] {
  return [
    {
      key: "input",
      label: t("usage.inputWithCache"),
      value: totals.inputTokens + totals.cacheReadTokens,
      kind: "tokens",
    },
    {
      key: "cacheInput",
      label: t("usage.cacheInput"),
      value: totals.cacheReadTokens,
      kind: "tokens",
    },
    {
      key: "cacheRate",
      label: t("usage.cacheRate"),
      value: cacheHitPercent(totals),
      kind: "percent",
    },
    { key: "output", label: t("usage.output"), value: totals.outputTokens, kind: "tokens" },
    {
      key: "reasoning",
      label: t("usage.reasoning"),
      value: totals.reasoningTokens,
      kind: "tokens",
    },
    ...(options.withActivity === false
      ? []
      : [
          { key: "turns", label: t("usage.turns"), value: totals.turns, kind: "count" as const },
          { key: "steps", label: t("usage.steps"), value: totals.steps, kind: "count" as const },
          {
            key: "userInputs",
            label: t("usage.userInputs"),
            value: totals.userInputs,
            kind: "count" as const,
          },
          {
            key: "toolCalls",
            label: t("usage.toolCalls"),
            value: totals.toolCalls,
            kind: "count" as const,
          },
        ]),
  ];
}

// 折叠行的排序口径（不显示）：输入（含缓存）+ 输出。
function sortWeight(totals: SessionUsageTotals): number {
  return totals.inputTokens + totals.cacheReadTokens + totals.outputTokens;
}

interface UsageListRow {
  key: string;
  label: string;
  totals: SessionUsageTotals;
  // 子代理派生会话的行（按会话维度才有此维度）。
  subagent?: boolean;
}

function emptyTotals(): SessionUsageTotals {
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

// 把桶按一个键折叠成行并按用量降序（按模型维度用它：人类的桶与子代理的桶折进同一行）。
function foldBuckets(
  buckets: readonly SessionUsageBucket[],
  keyOf: (bucket: SessionUsageBucket) => string,
): UsageListRow[] {
  const folded = new Map<string, SessionUsageTotals>();
  for (const bucket of buckets) {
    const key = keyOf(bucket);
    const previous = folded.get(key) ?? emptyTotals();
    folded.set(key, {
      turns: previous.turns,
      steps: previous.steps,
      userInputs: previous.userInputs,
      toolCalls: previous.toolCalls,
      inputTokens: previous.inputTokens + bucket.inputTokens,
      outputTokens: previous.outputTokens + bucket.outputTokens,
      cacheReadTokens: previous.cacheReadTokens + bucket.cacheReadTokens,
      reasoningTokens: previous.reasoningTokens + bucket.reasoningTokens,
      totalTokens: previous.totalTokens + bucket.totalTokens,
    });
  }
  const rows: UsageListRow[] = [...folded].map(([key, totals]) => ({ key, label: key, totals }));
  return rows.sort((left, right) => sortWeight(right.totals) - sortWeight(left.totals));
}

// 一行用量：label 在上（子代理行另带标记），下面是横向排布的单项。
function UsageRow({
  rowKey,
  label,
  totals,
  t,
  subagent,
  withActivity = true,
}: {
  rowKey: string;
  label: string;
  totals: SessionUsageTotals;
  t: ConversationManagerTranslate;
  subagent?: boolean | undefined;
  withActivity?: boolean | undefined;
}): ReactNode {
  return (
    <Stack
      as="li"
      gap={6}
      boxed
      pad="row"
      fixed
      data-usage-key={rowKey}
      {...(subagent === undefined ? {} : { "data-subagent": subagent ? "true" : "false" })}
    >
      <Row gap={8} grow>
        <Text size="sm" tone="tertiary" truncate>
          {label}
        </Text>
        {subagent === true ? <Tag tone="quiet">{t("subagent")}</Tag> : null}
      </Row>
      <Row gap="wide" wrap>
        {usageMetrics(totals, t, { withActivity }).map((metric) => (
          <Stack
            key={metric.key}
            data-usage-cell={metric.key}
            data-usage-value={metric.value}
            gap={2}
          >
            <Text size="sm" tone="tertiary">
              {metric.label}
            </Text>
            <Text size="lg" weight="medium" tabular>
              {metric.kind === "percent"
                ? formatPercent(metric.value)
                : metric.kind === "count"
                  ? formatCount(metric.value)
                  : formatTokens(metric.value)}
            </Text>
          </Stack>
        ))}
      </Row>
    </Stack>
  );
}

function UsageList({
  rows,
  t,
  withActivity = true,
}: {
  rows: readonly UsageListRow[];
  t: ConversationManagerTranslate;
  withActivity?: boolean | undefined;
}): ReactNode {
  if (rows.length === 0) {
    return (
      <Text data-usage-status="empty" as="p" size="md" tone="tertiary">
        {t("usage.empty")}
      </Text>
    );
  }
  return (
    <Stack as="ul" gap={4} plain>
      {rows.map((row) => (
        <UsageRow
          key={row.key}
          rowKey={row.key}
          label={row.label}
          totals={row.totals}
          t={t}
          {...(row.subagent === undefined ? {} : { subagent: row.subagent })}
          withActivity={withActivity}
        />
      ))}
    </Stack>
  );
}

// 总览：全部与「其中子代理」两行，与列表行同形。
function UsageOverview({
  report,
  t,
}: {
  report: SessionUsageValue;
  t: ConversationManagerTranslate;
}): ReactNode {
  return (
    <Stack as="ul" gap={4} plain>
      <UsageRow rowKey="all" label={t("usage.all")} totals={report.totals} t={t} />
      <UsageRow rowKey="subagent" label={t("usage.subagentOnly")} totals={report.subagent} t={t} />
    </Stack>
  );
}

export interface UsageViewProps {
  report: SessionUsageValue | null;
  loading: boolean;
  error: string | null;
  tab: UsageTab;
  onTab: (tab: UsageTab) => void;
  range: SessionUsageRange;
  onRange: (range: SessionUsageRange) => void;
  // 失败横幅的重试：重拉当前范围。
  onRetry: () => void;
  onlySubagents: boolean;
  onOnlySubagents: (next: boolean) => void;
  t: ConversationManagerTranslate;
}

// 统计视图：时间范围过滤 + 二层维度切换（总览 / 按模型 / 按会话）。
export function UsageView({
  report,
  loading,
  error,
  tab,
  onTab,
  range,
  onRange,
  onRetry,
  onlySubagents,
  onOnlySubagents,
  t,
}: UsageViewProps): ReactNode {
  const items: UsageTab[] = ["overview", "models", "sessions"];
  const labels: Record<UsageTab, string> = {
    overview: t("usage.overview"),
    models: t("usage.models"),
    sessions: t("usage.sessions"),
  };
  const rows: readonly UsageListRow[] =
    report === null || tab === "overview"
      ? []
      : tab === "models"
        ? foldBuckets(
            report.buckets,
            (bucket) =>
              (bucket.provider ?? t("usage.unknownModel")) +
              " / " +
              (bucket.model ?? t("usage.unknownModel")),
          )
        : report.sessions
            // 子代理会话单个用量小，混排时会被行数上限挤掉：给一个只看它们的开关。
            .filter((row: SessionUsageSessionRow) => !onlySubagents || row.subagent)
            .map((row) => ({
              key: row.sessionId,
              label: row.title ?? row.sessionId,
              totals: row,
              subagent: row.subagent,
            }))
            .sort((left, right) => sortWeight(right.totals) - sortWeight(left.totals))
            .slice(0, USAGE_SESSION_ROWS);
  return (
    <Stack
      data-usage-view={tab}
      data-usage-range={range}
      aria-busy={loading ? "true" : undefined}
      gap={12}
      fixed
    >
      <div
        className={frameCss.filterTabs}
        role="group"
        aria-label={t("usage.range")}
        data-filter="usage-range"
      >
        {USAGE_RANGES.map((option) => (
          <FilterChip
            key={option}
            active={option === range}
            label={rangeLabel(option, t)}
            tab={option}
            onSelect={() => {
              onRange(option);
            }}
          />
        ))}
      </div>
      <div
        className={frameCss.filterTabs}
        role="group"
        aria-label={t("usage.dimension")}
        data-filter="usage-tabs"
      >
        {items.map((item) => (
          <FilterChip
            key={item}
            active={item === tab}
            label={labels[item]}
            tab={item}
            onSelect={() => {
              onTab(item);
            }}
          />
        ))}
      </div>
      {tab === "sessions" ? (
        <div
          className={frameCss.filterTabs}
          role="group"
          aria-label={t("filter.subagents")}
          data-filter="usage-subagents"
        >
          <FilterChip
            active={onlySubagents}
            label={t("usage.onlySubagents")}
            onSelect={() => {
              onOnlySubagents(!onlySubagents);
            }}
          />
        </div>
      ) : null}
      {loading ? (
        <Text data-usage-status="loading" as="p" size="md" tone="tertiary">
          {t("usage.loading")}
        </Text>
      ) : null}
      {error === null ? null : (
        <Feedback
          tone="failure"
          source="usage"
          text={error}
          retry={{ label: t("retry"), onRetry }}
        />
      )}
      {report === null ? null : tab === "overview" ? (
        <UsageOverview report={report} t={t} />
      ) : (
        <UsageList rows={rows} t={t} withActivity={tab === "sessions"} />
      )}
    </Stack>
  );
}
