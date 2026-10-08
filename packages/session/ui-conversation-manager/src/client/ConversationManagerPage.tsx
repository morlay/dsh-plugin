// 「对话管理」页面：已归档会话的搜索、取消归档、导出、删除，以及导入为新会话与孤儿数据 GC。
// 数据面：会话行读**我们自己的**列表路由（注入面 listRows，含归档；搜索 / 子代理过滤 / 分页都在后端），
// 动作面只读注入面。
// 形态：页面框架与上游一级页面同款（960px 居中列 + 标题行 + 过滤 chip 行 + 搜索行，见
// `ConversationManagerPage.module.css`）；切换与过滤都用那套 chip（`role="group"` + `aria-pressed`），
// 读取 / 空语料 / 读列表失败三种状态整屏居中。
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Button,
  IconCloseOutlineRegular,
  IconSearchOutlineRegular,
  Input,
  Modal,
  Row,
  Spinner,
  Stack,
  Tag,
  Text,
  relativeTime,
} from "@morlay/dsh-client-ui-primitives/client";
import type { InjectFace, PropsLocale, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { SessionId } from "@deepseek-ai/dsh-session";
import {
  ConversationManagerRequestError,
  type ConversationManagerFace,
  type SessionRowsPage,
  type SessionUsageReport,
  type UsageBucket,
  type UsageRangeKey,
  type UsageTotals,
} from "./controller.ts";
import frameCss from "./ConversationManagerPage.module.css";
import { formatCount, formatPercent, formatTokens } from "./format.ts";

// 一页的行数（会话列表）。
const PAGE_SIZE = 20;

// 统计视图按会话列出时的行数上限。
const USAGE_SESSION_ROWS = 20;

// 页面 props：main 座位的运行时份额 + 本包字典 + 注入的动作。
export type ConversationManagerPageProps = PropsRuntime<"main"> &
  PropsLocale<"conversationManager"> &
  InjectFace<ConversationManagerFace>;

type Translate = ConversationManagerPageProps["t"];

// GC 的三段状态：确认 → 运行（阻塞界面）→ 收尾。
type GcPhase = "idle" | "confirm" | "running";

interface ConversationRow {
  id: SessionId;
  title: string;
  // 所属工作区标题；不在任何工作区里的会话用未分组文案。
  workspace: string;
  // 只有已归档的行允许取消归档与删除（host 侧同样守卫）。
  archived: boolean;
  // 子代理派生会话：默认不显示（既不可删也不可取消归档）。
  subagent: boolean;
  updatedAt: number;
}

// 行上显示的紧凑相对时间。
function timeLabel(updatedAt: number, now: number, t: Translate): string {
  const { unit, n } = relativeTime(updatedAt, now);
  return unit === "now" ? t("time.now") : t(`time.${unit}`, { n });
}

// host 错误码 → 可读文案；没有码时保留原文。
function failureText(error: unknown, t: Translate): string {
  const code = error instanceof ConversationManagerRequestError ? error.code : undefined;
  if (code === "SESSION_NOT_ARCHIVED") return t("failure.notArchived");
  if (code === "SESSION_LIVE") return t("failure.live");
  if (code === "SESSION_NOT_FOUND") return t("failure.missing");
  return t("failure.other", { reason: error instanceof Error ? error.message : String(error) });
}

// 过滤 chip：上游一级页面那套（28px 胶囊，选中那档带填充 + 主标签色）。语义是**筛选**：`role="group"` 的组里
// 每个 chip 用 `aria-pressed` 说选中，不是 tab 条。
function FilterChip({
  active,
  label,
  tab,
  onSelect,
}: {
  active: boolean;
  label: string;
  // `data-tab` 标注（沟通与 e2e 按它定位那一个 chip）。
  tab?: string;
  onSelect: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      className={active ? `${frameCss.filterTab} ${frameCss.filterTabActive}` : frameCss.filterTab}
      aria-pressed={active}
      {...(tab === undefined ? {} : { "data-tab": tab })}
      onClick={onSelect}
    >
      {label}
    </button>
  );
}

// 整屏居中的状态态：列表还没就绪 / 一份会话都没有 / 读列表失败。这三种时候页面没有别的内容可看，状态占满
// 整个面板（`.status` 住 `ConversationManagerPage.module.css`），因此不画标题行、过滤行与搜索行。
function PageStatus({
  t,
  status,
  text,
  spinner = false,
  failure = false,
}: {
  t: Translate;
  status: "loading" | "empty" | "failure";
  text: string;
  spinner?: boolean;
  failure?: boolean;
}): ReactNode {
  return (
    <section className={frameCss.page} aria-label={t("title")}>
      <div className={frameCss.listPane}>
        <div className={frameCss.status} data-status={status}>
          <div className={frameCss.statusBody}>
            {spinner ? <Spinner label={t("loading")} /> : null}
            <p
              className={
                failure ? `${frameCss.statusText} ${frameCss.statusFailure}` : frameCss.statusText
              }
              {...(failure ? { role: "alert" } : {})}
            >
              {text}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export function ConversationManagerPage({
  t,
  listRows,
  archive,
  unarchive,
  remove,
  exportZip,
  importZip,
  collectGarbage,
  loadUsage,
}: ConversationManagerPageProps): ReactNode {
  // 数据面是**我们自己的**列表路由（完整语料，含归档）：官方 `session/list` 按部署策略排除归档，
  // 归档集的管理动作要完整集合，两条路不混。搜索、子代理过滤与分页都在后端做（前端分页等于每次拉全量）。
  const [rowsPage, setRowsPage] = useState<SessionRowsPage | null>(null);
  const [rowsFailure, setRowsFailure] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [settledQuery, setSettledQuery] = useState("");
  const [page, setPage] = useState(1);
  const [showSubagents, setShowSubagents] = useState(false);
  const [view, setView] = useState<PageView>("sessions");
  const [usageTab, setUsageTab] = useState<UsageTab>("overview");
  const [usageRange, setUsageRange] = useState<UsageRange>("day");
  const [usageOnlySubagents, setUsageOnlySubagents] = useState(false);
  const [usage, setUsage] = useState<SessionUsageReport | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ConversationRow | null>(null);
  const [gcPhase, setGcPhase] = useState<GcPhase>("idle");
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const reloadRows = useCallback(async () => {
    try {
      // 后端分页：每次只拉当前页（PAGE_SIZE 条），翻页与搜索都重新请求。
      setRowsPage(
        await listRows({
          ...(settledQuery === "" ? {} : { query: settledQuery }),
          ...(showSubagents ? { includeSubagents: true } : {}),
          page,
          pageSize: PAGE_SIZE,
        }),
      );
      setRowsFailure(null);
    } catch (error: unknown) {
      setRowsFailure(failureText(error, t));
    }
  }, [listRows, t, settledQuery, showSubagents, page]);

  useEffect(() => {
    void reloadRows();
  }, [reloadRows]);

  // 搜索下推到后端：输入停一下再请求（每次按键都打 host 没必要）。
  useEffect(() => {
    if (query === settledQuery) return;
    const timer = window.setTimeout(() => {
      setSettledQuery(query);
      setPage(1);
    }, 250);
    return () => {
      window.clearTimeout(timer);
    };
  }, [query, settledQuery]);

  const ungrouped = t("ungrouped");

  // 当前页的行：标题、工作区归属、归档标记与最后活动时间都随行给出（归属由 host 算，页面不再自己映射）。
  const rows = useMemo<ConversationRow[]>(
    () =>
      (rowsPage?.items ?? []).map((record) => ({
        id: record.sessionId as SessionId,
        title: record.title ?? record.sessionId,
        workspace: record.workspace ?? ungrouped,
        archived: record.archived,
        subagent: record.origin === "subagent",
        updatedAt: record.updatedAt,
      })),
    [rowsPage, ungrouped],
  );

  // 一个动作的收尾：成败都收掉弹窗，失败把原因落到页面上的提示行。
  // 动作成功即重拉我们自己的列表（归档状态与标题都可能变）；失败只报错、不动列表。
  const run = (action: Promise<unknown>, settle?: () => void): void => {
    setFailure(null);
    setNotice(null);
    void action.then(
      () => {
        settle?.();
        void reloadRows();
      },
      (error: unknown) => {
        settle?.();
        setFailure(failureText(error, t));
      },
    );
  };

  const startGc = (): void => {
    setGcPhase("running");
    setFailure(null);
    setNotice(null);
    void collectGarbage().then(
      (result) => {
        setGcPhase("idle");
        setNotice(t("gc.done", { sessions: result.orphanSessions, events: result.orphanEvents }));
        void reloadRows();
      },
      (error: unknown) => {
        setGcPhase("idle");
        setFailure(failureText(error, t));
      },
    );
  };

  // 统计是按时间范围在 host 侧聚合的：进入统计视图拉一次，换范围再拉一次；维度切换本地折叠。
  const requestUsage = (range: UsageRange): void => {
    setUsageRange(range);
    setUsageLoading(true);
    setUsageError(null);
    void loadUsage(range)
      .then(
        (report) => {
          setUsage(report);
        },
        (error: unknown) => {
          setUsageError(failureText(error, t));
        },
      )
      .finally(() => {
        setUsageLoading(false);
      });
  };

  const openUsage = (): void => {
    setView("usage");
    if (usage === null && !usageLoading) requestUsage(usageRange);
  };

  if (rowsPage === null) {
    return rowsFailure === null ? (
      <PageStatus t={t} status="loading" text={t("loading")} spinner />
    ) : (
      <PageStatus t={t} status="failure" text={rowsFailure} failure />
    );
  }

  const now = Date.now();
  // 这一页就是后端给的那一页：搜索、子代理过滤与排序都在 host 做过，页面只渲染。
  const visible = rows;
  const total = rowsPage.total;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const matched = rows;
  const confirmed = confirming;

  // 一份会话都没有（也没在搜索）：标题行与搜索行都没有可做的事，整个面板就让给这个状态。
  if (total === 0 && settledQuery === "") {
    return <PageStatus t={t} status="empty" text={t("empty")} />;
  }

  return (
    <section className={frameCss.page} data-view={view} aria-label={t("title")}>
      <div className={frameCss.listPane}>
        <div className={frameCss.pageScroll} data-scroll="page">
          <div className={frameCss.pageContent}>
            <div className={frameCss.pageHeading}>
              <h1>{t("title")}</h1>
              <div className={frameCss.headingActions}>
                <Button
                  variant="outline"
                  size="sm"
                  data-action="import"
                  disabled={importing}
                  aria-busy={importing}
                  aria-label={importing ? t("importing") : t("import")}
                  onClick={() => {
                    fileRef.current?.click();
                  }}
                >
                  {importing ? t("importing") : t("import")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  data-action="gc"
                  disabled={gcPhase !== "idle"}
                  aria-label={t("gc.button")}
                  onClick={() => {
                    setFailure(null);
                    setNotice(null);
                    setGcPhase("confirm");
                  }}
                >
                  {t("gc.button")}
                </Button>
              </div>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".zip,application/zip"
              hidden
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file === undefined) return;
                setImporting(true);
                setFailure(null);
                setNotice(null);
                void importZip(file)
                  .then(
                    () => {
                      setNotice(t("imported"));
                    },
                    (error: unknown) => {
                      setFailure(failureText(error, t));
                    },
                  )
                  .finally(() => {
                    setImporting(false);
                  });
              }}
            />
            <div className={frameCss.filters}>
              <div
                className={frameCss.filterTabs}
                role="group"
                aria-label={t("filter.view")}
                data-filter="view"
              >
                <FilterChip
                  active={view === "sessions"}
                  label={t("view.sessions")}
                  tab="sessions"
                  onSelect={() => {
                    setView("sessions");
                  }}
                />
                <FilterChip
                  active={view === "usage"}
                  label={t("view.usage")}
                  tab="usage"
                  onSelect={openUsage}
                />
              </div>
            </div>
            {view === "usage" ? null : (
              <div className={frameCss.filters}>
                <div
                  className={frameCss.filterTabs}
                  role="group"
                  aria-label={t("filter.subagents")}
                  data-filter="subagents"
                >
                  <FilterChip
                    active={showSubagents}
                    label={t("showSubagents")}
                    onSelect={() => {
                      setShowSubagents(!showSubagents);
                      setPage(1);
                    }}
                  />
                </div>
              </div>
            )}
            {view === "usage" ? null : (
              <div className={frameCss.searchField}>
                <Input
                  data-filter="search"
                  type="search"
                  icon={<IconSearchOutlineRegular />}
                  value={query}
                  placeholder={t("search")}
                  aria-label={t("search")}
                  onChange={(event) => {
                    setQuery(event.currentTarget.value);
                    setPage(1);
                  }}
                />
                {query === "" ? null : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={frameCss.searchClear}
                    aria-label={t("clearSearch")}
                    onClick={() => {
                      setQuery("");
                      setPage(1);
                    }}
                  >
                    <IconCloseOutlineRegular />
                  </Button>
                )}
              </div>
            )}
            {view === "usage" ? (
              <UsageView
                report={usage}
                loading={usageLoading}
                error={usageError}
                tab={usageTab}
                onTab={setUsageTab}
                range={usageRange}
                onRange={requestUsage}
                onlySubagents={usageOnlySubagents}
                onOnlySubagents={setUsageOnlySubagents}
                t={t}
              />
            ) : (
              <div className={frameCss.list}>
                {notice === null ? null : (
                  <Text data-notice="result" as="p" size="md" tone="tertiary">
                    {notice}
                  </Text>
                )}
                {failure === null ? null : (
                  <Text data-failure="result" role="alert" as="p" size="md" tone="danger">
                    {failure}
                  </Text>
                )}
                {total === 0 ? (
                  <div className={frameCss.listStatus} data-status="empty-search">
                    <p className={frameCss.statusText}>{t("emptySearch")}</p>
                  </div>
                ) : null}
                {visible.length > 0 ? (
                  <Stack as="ul" gap={4} plain>
                    {visible.map((row) => (
                      <Row
                        as="li"
                        key={row.id}
                        gap={16}
                        justify="between"
                        boxed
                        pad="row"
                        fixed
                        data-session-id={String(row.id)}
                        data-archived={row.archived ? "true" : "false"}
                        data-subagent={row.subagent ? "true" : "false"}
                      >
                        <Stack gap={2} grow>
                          <Row gap={8} grow>
                            <Text size="md" truncate>
                              {row.title}
                            </Text>
                            {row.archived ? <Tag tone="neutral">{t("archived")}</Tag> : null}
                            {row.subagent ? <Tag tone="quiet">{t("subagent")}</Tag> : null}
                          </Row>
                          <Text size="sm" tone="tertiary">
                            {[row.workspace, timeLabel(row.updatedAt, now, t)].join(" · ")}
                          </Text>
                        </Stack>
                        <Row gap={8} fixed>
                          {row.archived ? (
                            <Button
                              variant="outline"
                              size="sm"
                              data-action="unarchive"
                              aria-label={t("unarchiveNamed", { title: row.title })}
                              onClick={() => {
                                run(unarchive(row.id));
                              }}
                            >
                              {t("unarchive")}
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              data-action="archive"
                              aria-label={t("archiveNamed", { title: row.title })}
                              onClick={() => {
                                run(archive(row.id));
                              }}
                            >
                              {t("archive")}
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            data-action="export"
                            aria-label={t("exportNamed", { title: row.title })}
                            onClick={() => {
                              run(exportZip(row.id));
                            }}
                          >
                            {t("export")}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!row.archived}
                            data-action="remove"
                            aria-label={t("removeNamed", { title: row.title })}
                            onClick={() => {
                              setFailure(null);
                              setNotice(null);
                              setConfirming(row);
                            }}
                          >
                            {t("remove")}
                          </Button>
                        </Row>
                      </Row>
                    ))}
                  </Stack>
                ) : null}
                {matched.length > 0 ? (
                  <Row
                    data-pagination=""
                    data-page-current={currentPage}
                    data-page-total={pageCount}
                    gap={8}
                    justify="end"
                    fixed
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={currentPage <= 1}
                      onClick={() => {
                        setPage(currentPage - 1);
                      }}
                    >
                      {t("page.previous")}
                    </Button>
                    <Text size="sm" tone="tertiary" tabular>
                      {t("page.label", { page: currentPage, total: pageCount })}
                    </Text>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={currentPage >= pageCount}
                      onClick={() => {
                        setPage(currentPage + 1);
                      }}
                    >
                      {t("page.next")}
                    </Button>
                  </Row>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
      <Modal
        open={confirmed !== null}
        onClose={() => {
          setConfirming(null);
        }}
        title={t("confirmTitle")}
        closeLabel={t("close")}
        description={t("confirmDescription")}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirming(null);
              }}
            >
              {t("confirmCancel")}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (confirmed === null) return;
                run(remove(confirmed.id), () => {
                  setConfirming(null);
                });
              }}
            >
              {t("confirmAccept")}
            </Button>
          </>
        }
      />
      <Modal
        open={gcPhase === "confirm"}
        onClose={() => {
          setGcPhase("idle");
        }}
        title={t("gc.title")}
        closeLabel={t("close")}
        description={t("gc.description")}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setGcPhase("idle");
              }}
            >
              {t("gc.cancel")}
            </Button>
            <Button variant="primary" onClick={startGc}>
              {t("gc.confirm")}
            </Button>
          </>
        }
      />
      {/* 运行期不给关闭手段：没有关闭按钮，mask 与 Escape 都只走空 onClose。 */}
      <Modal open={gcPhase === "running"} onClose={() => {}} headless title={t("gc.title")}>
        <Stack align="center" gap={14} pad="blocking">
          <Spinner label={t("gc.running")} />
          <Text as="p" size="md">
            {t("gc.running")}
          </Text>
        </Stack>
      </Modal>
    </section>
  );
}

// 一层视图：会话列表 / 用量统计。
type PageView = "sessions" | "usage";

// 统计视图的二层维度。
type UsageTab = "overview" | "models" | "sessions";

// 时间范围选项：默认本日，其后是本周（周一起算）与最近 N 天，「全部」放在最后。
const USAGE_RANGES: readonly UsageRange[] = ["day", "week", "7d", "30d", "90d", "all"];

type UsageRange = UsageRangeKey;

// 范围按钮的文案。
function rangeLabel(range: UsageRange, t: Translate): string {
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
function cacheHitPercent(totals: UsageTotals): number {
  const total = totals.inputTokens + totals.cacheReadTokens;
  if (total <= 0) return 0;
  return (totals.cacheReadTokens / total) * 100;
}

// 显示口径的单项：输入（含缓存输入）、缓存输入、缓存命中率、输出、推理，
// 以及活动计数（轮次 / 步骤 / 用户输入 / 工具调用）——没有合计项。
// 活动计数在按模型的行上不显示（事件没有模型归属，见 `withActivity`）。
function usageMetrics(
  totals: UsageTotals,
  t: Translate,
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
function sortWeight(totals: UsageTotals): number {
  return totals.inputTokens + totals.cacheReadTokens + totals.outputTokens;
}

interface UsageListRow {
  key: string;
  label: string;
  totals: UsageTotals;
  // 子代理派生会话的行（按会话维度才有此维度；其余维度不带标记）。
  subagent?: boolean;
}

function emptyTotals(): UsageTotals {
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
  buckets: readonly UsageBucket[],
  keyOf: (bucket: UsageBucket) => string,
): UsageListRow[] {
  const folded = new Map<string, UsageListRow>();
  for (const bucket of buckets) {
    const key = keyOf(bucket);
    const row = folded.get(key) ?? { key, label: key, totals: emptyTotals() };
    row.totals.inputTokens += bucket.inputTokens;
    row.totals.outputTokens += bucket.outputTokens;
    row.totals.cacheReadTokens += bucket.cacheReadTokens;
    row.totals.reasoningTokens += bucket.reasoningTokens;
    row.totals.totalTokens += bucket.totalTokens;
    folded.set(key, row);
  }
  return [...folded.values()].sort(
    (left, right) => sortWeight(right.totals) - sortWeight(left.totals),
  );
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
  totals: UsageTotals;
  t: Translate;
  subagent?: boolean;
  withActivity?: boolean;
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
  t: Translate;
  withActivity?: boolean;
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
function UsageOverview({ report, t }: { report: SessionUsageReport; t: Translate }): ReactNode {
  return (
    <Stack as="ul" gap={4} plain>
      <UsageRow rowKey="all" label={t("usage.all")} totals={report.totals} t={t} />
      <UsageRow rowKey="subagent" label={t("usage.subagentOnly")} totals={report.subagent} t={t} />
    </Stack>
  );
}

// 统计视图：时间范围过滤 + 二层维度切换（总览 / 按模型 / 按会话）。
function UsageView({
  report,
  loading,
  error,
  tab,
  onTab,
  range,
  onRange,
  onlySubagents,
  onOnlySubagents,
  t,
}: {
  report: SessionUsageReport | null;
  loading: boolean;
  error: string | null;
  tab: UsageTab;
  onTab: (tab: UsageTab) => void;
  range: UsageRange;
  onRange: (range: UsageRange) => void;
  onlySubagents: boolean;
  onOnlySubagents: (next: boolean) => void;
  t: Translate;
}): ReactNode {
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
              `${bucket.provider ?? t("usage.unknownModel")} / ${bucket.model ?? t("usage.unknownModel")}`,
          )
        : report.sessions
            // 子代理会话单个用量小，混排时会被行数上限挤掉：给一个只看它们的开关（过滤在本页，数据已全量在手）。
            .filter((row) => !onlySubagents || row.subagent)
            .map((row) => ({
              key: row.sessionId,
              label: row.title ?? row.sessionId,
              totals: row,
              subagent: row.subagent,
            }))
            .sort((left, right) => sortWeight(right.totals) - sortWeight(left.totals))
            .slice(0, USAGE_SESSION_ROWS);
  return (
    <Stack data-usage-view={tab} data-usage-range={range} gap={12} fixed>
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
        <Text data-usage-status="error" role="alert" as="p" size="md" tone="danger">
          {error}
        </Text>
      )}
      {report === null ? null : tab === "overview" ? (
        <UsageOverview report={report} t={t} />
      ) : (
        <UsageList rows={rows} t={t} withActivity={tab === "sessions"} />
      )}
    </Stack>
  );
}
