// 「对话管理」页面：已归档会话的搜索、归档 / 取消归档、导出、删除与覆盖导入，以及导入为新会话、
// 整理数据（孤儿回收 + 统计重算）与 token 用量统计。
//
// 页面只读注入面（`t` + `ConversationManagerFace`），wire 与下载细节归 controller；列表的取数、
// 搜索防抖、分页、在途与失败保留旧行归 `useRowsQuery`，动作的提示 / 失败 / 在途归 `useActionFeedback`，
// 失败与成功都经同一套反馈面呈现，页面只渲染并把动作接到面上。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
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
  VisuallyHidden,
  relativeTime,
} from "@morlay/zephyr-ui";
import type {
  SessionConsistencyValue,
  SessionOrganizeValue,
  SessionRepairAction,
  SessionUsageRange,
  SessionUsageValue,
} from "@morlay/session-rdb/endpoint";
import { useActionFeedback } from "../shared/action-feedback.ts";
import { Feedback } from "../shared/feedback.tsx";
import frameCss from "./conversation-manager-page.module.css";
import { ConversationManagerRequestError } from "./conversation-manager.controller.ts";
import type {
  ConversationImportStage,
  ConversationManagerFace,
  ConversationWorkspaceOption,
} from "./conversation-manager.controller.ts";
import { ConsistencyPanel } from "./consistency-panel.tsx";
import { LocateModal } from "./locate-modal.tsx";
import { failureCopy, failureText } from "./failure.ts";
import { FilterChip } from "./filter-chip.tsx";
import { RepairModal } from "./repair-modal.tsx";
import type { ConversationManagerTranslate } from "./locales.ts";
import { useRowsQuery } from "./rows-query.ts";
import type { ConversationRow } from "./rows-query.ts";
import { UsageView } from "./usage-view.tsx";
import type { UsageTab } from "./usage-view.tsx";

// 页面 props：本包字典的翻译座 + 注入的动作。
export interface ConversationManagerPageProps extends ConversationManagerFace {
  t: ConversationManagerTranslate;
}

// 整理数据的三段状态：确认 → 运行（阻塞界面）→ 收尾。
type OrganizePhase = "idle" | "confirm" | "running";

// 一层视图：会话列表 / 用量统计。
type PageView = "sessions" | "usage";

// 文件选择的意图：导入为新会话，或覆盖某一行的会话。
type FileIntent =
  | { readonly kind: "new" }
  | { readonly kind: "replace"; readonly row: ConversationRow };

// 正在等确认的覆盖导入（文件已选好，等用户确认才发请求）。
interface PendingReplace {
  readonly row: ConversationRow;
  readonly file: File;
}

// 行上显示的紧凑相对时间。
function timeLabel(updatedAt: number, now: number, t: ConversationManagerTranslate): string {
  const { unit, n } = relativeTime(updatedAt, now);
  switch (unit) {
    case "now":
      return t("time.now");
    case "minutes":
      return t("time.minutes", { n });
    case "hours":
      return t("time.hours", { n });
    case "days":
      return t("time.days", { n });
    case "months":
      return t("time.months", { n });
    case "years":
      return t("time.years", { n });
  }
}

// 整屏居中的状态态：列表还没就绪 / 读列表失败——这两种时候页面没有别的内容可看。
function PageStatus({
  t,
  status,
  text,
  spinner = false,
  onRetry,
}: {
  t: ConversationManagerTranslate;
  status: "loading" | "failure";
  text: string;
  spinner?: boolean | undefined;
  // 读失败时唯一的自救入口：没有它，用户只能切视图或改搜索词才碰巧重试。
  onRetry?: (() => void) | undefined;
}): ReactNode {
  return (
    <section className={frameCss.page} aria-label={t("title")}>
      <div className={frameCss.listPane}>
        <div className={frameCss.status} data-status={status}>
          <div className={frameCss.statusBody}>
            {spinner ? <Spinner label={text} /> : null}
            {status === "failure" ? (
              <Feedback
                tone="failure"
                source="rows"
                text={text}
                {...(onRetry === undefined ? {} : { retry: { label: t("retry"), onRetry } })}
              />
            ) : (
              <p className={frameCss.statusText}>{text}</p>
            )}
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
  bulkDelete,
  exportZip,
  exportFiltered,
  importZip,
  importMany,
  locateEvents,
  listWorkspaces,
  copyToWorkspace,
  organizeData,
  loadUsage,
  checkConsistency,
  repairSession,
}: ConversationManagerPageProps): ReactNode {
  const rowsQuery = useRowsQuery({ listRows }, t);
  const copy = useMemo(() => failureCopy(t), [t]);
  const describeFailure = useCallback((error: unknown) => failureText(error, copy), [copy]);
  const feedback = useActionFeedback(describeFailure);
  const [view, setView] = useState<PageView>("sessions");
  const [usageTab, setUsageTab] = useState<UsageTab>("overview");
  const [usageRange, setUsageRange] = useState<SessionUsageRange>("day");
  const [usageOnlySubagents, setUsageOnlySubagents] = useState(false);
  const [usage, setUsage] = useState<SessionUsageValue | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ConversationRow | null>(null);
  const [bulkConfirming, setBulkConfirming] = useState(false);
  const [bulkArchiving, setBulkArchiving] = useState(false);
  // 多选的 id 集：行重拉后只保留仍在当前页里的那些（已删的行不该继续被选中）。
  const [selectedRaw, setSelected] = useState<ReadonlySet<string>>(new Set<string>());
  const [replacing, setReplacing] = useState<PendingReplace | null>(null);
  const [organizePhase, setOrganizePhase] = useState<OrganizePhase>("idle");
  const [consistency, setConsistency] = useState<SessionConsistencyValue | null>(null);
  const [consistencyLoading, setConsistencyLoading] = useState(false);
  // 正在等确认修复的会话（两个日志修法都从这个弹窗发起）。
  const [repairing, setRepairing] = useState<ConversationRow | null>(null);
  // 正在定位事件的会话（只读入口，条件是弹窗里的事）。
  const [locating, setLocating] = useState<ConversationRow | null>(null);
  // 正在等确认的跨工作区复制：源会话、可选的目标工作区（null 表示还在读）、当前选择。
  const [copySource, setCopySource] = useState<ConversationRow | null>(null);
  const [copyWorkspaces, setCopyWorkspaces] = useState<
    readonly ConversationWorkspaceOption[] | null
  >(null);
  const [copyWorkspaceId, setCopyWorkspaceId] = useState("");
  const [importStage, setImportStage] = useState<ConversationImportStage | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fileIntent = useRef<FileIntent>({ kind: "new" });
  // 统计请求身份：只有最后发出的那次响应能落到界面上。
  const usageRequest = useRef(0);
  // 动作成功后焦点的落点：行会被重拉，按钮不是稳定的位置。
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [focusToken, setFocusToken] = useState(0);
  // 相对时间的分母：**这次取数的取样时刻**（`useRowsQuery` 在发请求那一拍取的），不是渲染时读的时钟。
  // 渲染期读 `Date.now()` 会让同一屏的行文案每次渲染都变，规则也直接拒（`react/purity`）；
  // 钉在取数上之后，「3 分钟前」是相对**这份列表**说的，行重拉（翻页 / 搜索 / 动作）时一起刷新。
  const now = rowsQuery.sampledAt;

  useEffect(() => {
    if (focusToken === 0) return;
    headingRef.current?.focus();
  }, [focusToken]);

  const focusHeading = useCallback(() => {
    setFocusToken((token) => token + 1);
  }, []);

  // 当前页的行 id：行被删掉后从选择里剔除（否则批量条上的计数与动作指向不存在的行）。
  // 这是**派生状态**：有效选择集 = 原始选择 ∩ 当前页的行，不 setState，也不需要 effect。
  const rowIds = useMemo(() => new Set(rowsQuery.rows.map((row) => row.id)), [rowsQuery.rows]);
  const selected = useMemo(
    () =>
      selectedRaw.size === 0
        ? selectedRaw
        : new Set([...selectedRaw].filter((id) => rowIds.has(id))),
    [selectedRaw, rowIds],
  );

  const toggleSelect = (id: string): void => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const reloadRows = (): void => {
    void rowsQuery.reload();
  };

  // 一个行内动作：失败落到提示行，成功即重拉列表并把焦点收回标题。
  const runRowAction = (action: Promise<unknown>): void => {
    feedback.run(action, {
      onSuccess: () => {
        reloadRows();
        focusHeading();
      },
    });
  };

  // 批量归档：**不进本包**（归档的 owner 在 workspace 域），页面逐条调注入的归档动作，
  // 逐条收集失败再聚合成一条提示（哪一条没归档成功、为什么）。
  const runBulkArchive = (ids: readonly string[]): void => {
    const action = Promise.allSettled(ids.map((id) => archive(id))).then((results) => {
      const failed = results.flatMap((result, index) =>
        result.status === "rejected" ? [{ id: String(ids[index]), reason: result.reason }] : [],
      );
      const details = failed
        .map((item) => t("bulk.failed", { title: item.id, reason: describeFailure(item.reason) }))
        .join("；");
      feedback.notify(
        t("bulkArchive.done", { archived: results.length - failed.length, failed: failed.length }) +
          (details === "" ? "" : " " + details),
      );
      return results;
    });
    feedback.run(action, {
      onSuccess: () => {
        setSelected(new Set<string>());
        reloadRows();
        focusHeading();
      },
      onSettled: () => {
        setBulkArchiving(false);
      },
    });
  };

  // 批量删除：整批一次请求，逐条结果聚合成一条提示（失败的项带原因）；成功的行由重拉消失。
  const runBulkDelete = (ids: readonly string[]): void => {
    const action = bulkDelete(ids).then((value) => {
      const failed = value.items.filter((item) => !item.ok);
      const deleted = value.items.length - failed.length;
      const details = failed
        .map((item) =>
          t("bulk.failed", {
            title: item.sessionId,
            reason: failureText(new ConversationManagerRequestError("", item.code), copy),
          }),
        )
        .join("；");
      feedback.notify(
        t("bulk.done", { deleted, failed: failed.length }) + (details === "" ? "" : " " + details),
      );
      return value;
    });
    feedback.run(action, {
      onSuccess: () => {
        setSelected(new Set<string>());
        reloadRows();
        focusHeading();
      },
      onSettled: () => {
        setBulkConfirming(false);
      },
    });
  };

  // 批量导出：按当前筛选结果各下载一份；成败聚合成一句提示（失败条只有域码）。
  const runExportFiltered = (): void => {
    const action = exportFiltered(rowsQuery.filters).then((value) => {
      const failed = value.items.filter((item) => !item.ok);
      feedback.notify(
        t("exportFiltered.done", {
          exported: value.items.length - failed.length,
          failed: failed.length,
        }),
      );
      return value;
    });
    feedback.run(action, {
      onSuccess: () => {
        focusHeading();
      },
    });
  };

  const pickFile = (intent: FileIntent): void => {
    fileIntent.current = intent;
    fileRef.current?.click();
  };

  // 导入：阶段变化落到提示行；成功提示与重拉由动作反馈统一收尾。
  const importFile = (file: File, options: { sessionId?: string; success: string }): void => {
    setImportStage("reading");
    feedback.run(
      importZip(file, {
        ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
        onStage: (stage) => {
          setImportStage(stage);
        },
      }),
      {
        success: options.success,
        onSettled: () => {
          setImportStage(null);
        },
        onSuccess: () => {
          reloadRows();
          focusHeading();
        },
      },
    );
  };

  // 批量导入：多个 zip 一次交给宿主（`sessionAdmin/importMany`），逐条结果聚合成一条提示；
  // 失败的条目按**选中的文件名**给原因（宿主只回 package 里的 artifact 名，认不回用户选的是哪一个）。
  const importFiles = (files: readonly File[]): void => {
    setImportStage("reading");
    const action = importMany(files).then((value) => {
      const failed = value.items.flatMap((item, index) =>
        item.ok
          ? []
          : [
              {
                name: files[index]?.name ?? t("importMany.package", { n: index + 1 }),
                reason: failureText(new ConversationManagerRequestError("", item.code), copy),
              },
            ],
      );
      const details = failed
        .map((item) => t("bulk.failed", { title: item.name, reason: item.reason }))
        .join("；");
      feedback.notify(
        t("importMany.done", {
          imported: value.items.length - failed.length,
          failed: failed.length,
        }) + (details === "" ? "" : " " + details),
      );
      return value;
    });
    feedback.run(action, {
      onSettled: () => {
        setImportStage(null);
      },
      onSuccess: () => {
        reloadRows();
        focusHeading();
      },
    });
  };

  // 跨工作区复制：先读工作区列表（owner 在 workspace 域），确认后由宿主的 fork + attach 组合完成。
  const openCopy = (row: ConversationRow): void => {
    setCopySource(row);
    setCopyWorkspaces(null);
    setCopyWorkspaceId("");
    feedback.clear();
    void listWorkspaces().then(
      (options) => {
        setCopyWorkspaces(options);
      },
      (error: unknown) => {
        setCopySource(null);
        feedback.reject(describeFailure(error));
      },
    );
  };

  const runCopy = (row: ConversationRow, workspaceId: string): void => {
    const workspace = copyWorkspaces?.find((option) => option.workspaceId === workspaceId);
    const copied = copyToWorkspace(row.id, workspaceId).then((value) => {
      feedback.notify(t("copy.done", { workspace: workspace?.title ?? workspaceId }));
      return value;
    });
    feedback.run(copied, {
      onSettled: () => {
        setCopySource(null);
      },
      onSuccess: () => {
        reloadRows();
        focusHeading();
      },
    });
  };

  const startOrganize = (): void => {
    setOrganizePhase("running");
    feedback.clear();
    void organizeData().then(
      (result: SessionOrganizeValue) => {
        setOrganizePhase("idle");
        feedback.notify(
          t("organize.done", {
            sessions: result.orphanSessions,
            events: result.orphanEvents,
            rebuilt: result.rebuiltSessions,
          }),
        );
        reloadRows();
        focusHeading();
      },
      (error: unknown) => {
        setOrganizePhase("idle");
        feedback.reject(describeFailure(error));
      },
    );
  };

  // 体检只读：报告落到面板上；失败走同一条失败通道（报告保留上一次的结果）。
  const runConsistency = (): void => {
    setConsistencyLoading(true);
    feedback.clear();
    void checkConsistency().then(
      (report) => {
        setConsistency(report);
        setConsistencyLoading(false);
      },
      (error: unknown) => {
        setConsistencyLoading(false);
        feedback.reject(describeFailure(error));
      },
    );
  };

  // 修复：结果带着保留 / 丢弃条数，成功后重拉列表（坏会话修好了也还在列表里，但读得出来）。
  const runRepair = (row: ConversationRow, action: SessionRepairAction): void => {
    const repaired = repairSession(row.id, action).then((value) => {
      feedback.notify(t("repair.done", { kept: value.keptEvents, dropped: value.droppedEvents }));
      return value;
    });
    feedback.run(repaired, {
      onSuccess: () => {
        reloadRows();
        focusHeading();
      },
      onSettled: () => {
        setRepairing(null);
      },
    });
  };

  // 统计是按时间范围在宿主侧聚合的：进入统计视图拉一次，换范围再拉一次；维度切换本地折叠。
  const requestUsage = (range: SessionUsageRange): void => {
    const requestId = ++usageRequest.current;
    setUsageRange(range);
    setUsageLoading(true);
    setUsageError(null);
    void loadUsage(range)
      .then(
        (report) => {
          if (requestId === usageRequest.current) setUsage(report);
        },
        (error: unknown) => {
          if (requestId === usageRequest.current) setUsageError(describeFailure(error));
        },
      )
      .finally(() => {
        if (requestId === usageRequest.current) setUsageLoading(false);
      });
  };

  const openUsage = (): void => {
    setView("usage");
    if (usage === null && !usageLoading) requestUsage(usageRange);
  };

  if (!rowsQuery.ready) {
    return rowsQuery.failure === null ? (
      <PageStatus t={t} status="loading" text={t("loading")} spinner />
    ) : (
      <PageStatus t={t} status="failure" text={rowsQuery.failure} onRetry={reloadRows} />
    );
  }

  const rows = rowsQuery.rows;
  const currentPage = rowsQuery.currentPage;
  const pageCount = rowsQuery.pageCount;
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));
  const toggleSelectAll = (): void => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (allSelected) {
        for (const row of rows) next.delete(row.id);
      } else {
        for (const row of rows) next.add(row.id);
      }
      return next;
    });
  };

  return (
    <section className={frameCss.page} data-view={view} aria-label={t("title")}>
      <div className={frameCss.listPane}>
        <div className={frameCss.pageScroll} data-scroll="page">
          <div className={frameCss.pageContent}>
            <div className={frameCss.pageHeading}>
              <h1 ref={headingRef} tabIndex={-1}>
                {t("title")}
              </h1>
              <div className={frameCss.headingActions}>
                <Button
                  variant="outline"
                  size="sm"
                  data-action="import"
                  disabled={importStage !== null}
                  aria-busy={importStage !== null}
                  aria-label={importStage === null ? t("import") : t("importing")}
                  onClick={() => {
                    pickFile({ kind: "new" });
                  }}
                >
                  {importStage === null ? t("import") : t("importing")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  data-action="export-filtered"
                  disabled={rows.length === 0 || feedback.busy}
                  aria-label={t("exportFiltered")}
                  onClick={runExportFiltered}
                >
                  {t("exportFiltered")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  data-action="consistency"
                  disabled={consistencyLoading}
                  aria-busy={consistencyLoading ? "true" : undefined}
                  aria-label={t("consistency.button")}
                  onClick={runConsistency}
                >
                  {t("consistency.button")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  data-action="gc"
                  disabled={organizePhase !== "idle"}
                  aria-label={t("organize.button")}
                  onClick={() => {
                    feedback.clear();
                    setOrganizePhase("confirm");
                  }}
                >
                  {t("organize.button")}
                </Button>
              </div>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".zip,application/zip"
              multiple
              hidden
              onChange={(event) => {
                const files = [...(event.currentTarget.files ?? [])];
                event.currentTarget.value = "";
                const file = files[0];
                if (file === undefined) return;
                const intent = fileIntent.current;
                if (intent.kind === "replace") {
                  // 覆盖会整段替换该会话的日志：先确认，确认前不发请求。
                  setReplacing({ row: intent.row, file });
                  return;
                }
                // 多选 zip = 一次批量导入；单个文件仍走单条导入（阶段回调与提示不变）。
                if (files.length > 1) {
                  importFiles(files);
                  return;
                }
                importFile(file, { success: t("imported") });
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
                    active={rowsQuery.showSubagents}
                    label={t("showSubagents")}
                    onSelect={rowsQuery.toggleSubagents}
                  />
                </div>
              </div>
            )}
            {view === "usage" ? null : (
              <div className={frameCss.filters}>
                <div
                  className={frameCss.filterTabs}
                  role="group"
                  aria-label={t("filter.time")}
                  data-filter="time"
                >
                  <FilterChip
                    active={rowsQuery.timeFilter === "all"}
                    label={t("filter.time.all")}
                    tab="all"
                    onSelect={() => {
                      rowsQuery.setTimeFilter("all");
                    }}
                  />
                  <FilterChip
                    active={rowsQuery.timeFilter === "7d"}
                    label={t("filter.time.7d")}
                    tab="7d"
                    onSelect={() => {
                      rowsQuery.setTimeFilter("7d");
                    }}
                  />
                  <FilterChip
                    active={rowsQuery.timeFilter === "30d"}
                    label={t("filter.time.30d")}
                    tab="30d"
                    onSelect={() => {
                      rowsQuery.setTimeFilter("30d");
                    }}
                  />
                </div>
                <div
                  className={frameCss.filterTabs}
                  role="group"
                  aria-label={t("filter.archived")}
                  data-filter="archived"
                >
                  <FilterChip
                    active={rowsQuery.archivedFilter === "all"}
                    label={t("filter.archived.all")}
                    tab="all"
                    onSelect={() => {
                      rowsQuery.setArchivedFilter("all");
                    }}
                  />
                  <FilterChip
                    active={rowsQuery.archivedFilter === "only"}
                    label={t("filter.archived.only")}
                    tab="only"
                    onSelect={() => {
                      rowsQuery.setArchivedFilter("only");
                    }}
                  />
                  <FilterChip
                    active={rowsQuery.archivedFilter === "unarchived"}
                    label={t("filter.archived.unarchived")}
                    tab="unarchived"
                    onSelect={() => {
                      rowsQuery.setArchivedFilter("unarchived");
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
                  value={rowsQuery.query}
                  placeholder={t("search")}
                  aria-label={t("search")}
                  onChange={(event) => {
                    rowsQuery.setQuery(event.currentTarget.value);
                  }}
                />
                {rowsQuery.query === "" ? null : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={frameCss.searchClear}
                    aria-label={t("clearSearch")}
                    onClick={rowsQuery.clearQuery}
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
                onRetry={() => {
                  requestUsage(usageRange);
                }}
                onlySubagents={usageOnlySubagents}
                onOnlySubagents={setUsageOnlySubagents}
                t={t}
              />
            ) : (
              <div
                className={frameCss.list}
                data-list=""
                data-search-stage={rowsQuery.searchStage}
                aria-busy={rowsQuery.loading ? "true" : undefined}
              >
                {importStage === null ? null : (
                  <Feedback
                    tone="notice"
                    source="import"
                    busy
                    text={t(importStage === "reading" ? "import.reading" : "import.committing")}
                  />
                )}
                <ConsistencyPanel report={consistency} loading={consistencyLoading} t={t} />
                {feedback.notice === null ? null : (
                  <Feedback tone="notice" source="result" text={feedback.notice} />
                )}
                {feedback.failure === null ? null : (
                  <Feedback tone="failure" source="result" text={feedback.failure} />
                )}
                {rowsQuery.failure === null ? null : (
                  <Feedback
                    tone="failure"
                    source="reload"
                    text={rowsQuery.failure}
                    retry={{ label: t("retry"), onRetry: reloadRows }}
                  />
                )}
                <VisuallyHidden>
                  <span role="status" data-announce="rows">
                    {rowsQuery.announcement ?? ""}
                  </span>
                </VisuallyHidden>
                {rows.length === 0 ? (
                  <div
                    className={frameCss.listStatus}
                    data-status={rowsQuery.settledQuery === "" ? "empty" : "empty-search"}
                  >
                    <p className={frameCss.statusText}>
                      {rowsQuery.settledQuery === "" ? t("empty") : t("emptySearch")}
                    </p>
                    {rowsQuery.settledQuery === "" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={importStage !== null}
                        onClick={() => {
                          pickFile({ kind: "new" });
                        }}
                      >
                        {t("import")}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {rows.length === 0 ? null : (
                  <Row
                    as="div"
                    gap={8}
                    justify="between"
                    fixed
                    data-bulk={selected.size === 0 ? "idle" : "active"}
                  >
                    <label>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        aria-label={t("selectAll")}
                        onChange={toggleSelectAll}
                      />
                      <Text size="sm" tone="tertiary">
                        {t("selectAll")}
                      </Text>
                    </label>
                    {selected.size === 0 ? null : (
                      <Row gap={8} fixed>
                        <Text size="sm" tone="tertiary">
                          {t("bulk.selected", { count: selected.size })}
                        </Text>
                        <Button
                          variant="outline"
                          size="sm"
                          data-action="bulk-archive"
                          disabled={feedback.busy}
                          onClick={() => {
                            setBulkArchiving(true);
                          }}
                        >
                          {t("bulk.archiveNamed", { count: selected.size })}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          data-action="bulk-remove"
                          disabled={feedback.busy}
                          onClick={() => {
                            setBulkConfirming(true);
                          }}
                        >
                          {t("bulk.removeNamed", { count: selected.size })}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelected(new Set<string>());
                          }}
                        >
                          {t("bulk.clear")}
                        </Button>
                      </Row>
                    )}
                  </Row>
                )}
                {rows.length === 0 ? null : (
                  <Stack as="ul" gap={4} plain>
                    {rows.map((row) => (
                      <Row
                        as="li"
                        key={row.id}
                        gap={16}
                        justify="between"
                        boxed
                        pad="row"
                        fixed
                        data-session-id={row.id}
                        data-archived={row.archived ? "true" : "false"}
                        data-subagent={row.subagent ? "true" : "false"}
                      >
                        <input
                          type="checkbox"
                          data-select={row.id}
                          checked={selected.has(row.id)}
                          aria-label={t("selectNamed", { title: row.title })}
                          onChange={() => {
                            toggleSelect(row.id);
                          }}
                        />
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
                              disabled={feedback.busy}
                              aria-label={t("unarchiveNamed", { title: row.title })}
                              onClick={() => {
                                runRowAction(unarchive(row.id));
                              }}
                            >
                              {t("unarchive")}
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              data-action="archive"
                              disabled={feedback.busy}
                              aria-label={t("archiveNamed", { title: row.title })}
                              onClick={() => {
                                runRowAction(archive(row.id));
                              }}
                            >
                              {t("archive")}
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            data-action="export"
                            disabled={feedback.busy}
                            aria-label={t("exportNamed", { title: row.title })}
                            onClick={() => {
                              runRowAction(exportZip(row.id));
                            }}
                          >
                            {t("export")}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            data-action="repair"
                            disabled={feedback.busy}
                            aria-label={t("repairNamed", { title: row.title })}
                            onClick={() => {
                              setRepairing(row);
                            }}
                          >
                            {t("repair")}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            data-action="locate"
                            disabled={feedback.busy}
                            aria-label={t("locateNamed", { title: row.title })}
                            onClick={() => {
                              setLocating(row);
                            }}
                          >
                            {t("locate")}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            data-action="copy"
                            disabled={feedback.busy}
                            aria-label={t("copyNamed", { title: row.title })}
                            onClick={() => {
                              openCopy(row);
                            }}
                          >
                            {t("copyWorkspace")}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            data-action="replace"
                            disabled={feedback.busy || importStage !== null}
                            aria-label={t("importReplaceNamed", { title: row.title })}
                            onClick={() => {
                              pickFile({ kind: "replace", row });
                            }}
                          >
                            {t("importReplace")}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            data-action="remove"
                            disabled={feedback.busy}
                            aria-disabled={row.archived ? undefined : "true"}
                            aria-label={t("removeNamed", { title: row.title })}
                            onClick={() => {
                              // 未归档的会话不能删除：按钮可聚焦，点了给理由，不用无理由的原生 disabled。
                              if (!row.archived) {
                                feedback.reject(t("failure.notArchived"));
                                return;
                              }
                              setConfirming(row);
                            }}
                          >
                            {t("remove")}
                          </Button>
                        </Row>
                      </Row>
                    ))}
                  </Stack>
                )}
                {rows.length === 0 ? null : (
                  <Row
                    as="nav"
                    aria-label={t("page.nav")}
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
                        rowsQuery.goToPage(currentPage - 1);
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
                        rowsQuery.goToPage(currentPage + 1);
                      }}
                    >
                      {t("page.next")}
                    </Button>
                  </Row>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      <Modal
        open={confirming !== null}
        onClose={() => {
          setConfirming(null);
        }}
        title={t("confirmTitle")}
        closeLabel={t("close")}
        tone="warning"
        description={t("confirmDescription")}
        footer={
          <>
            <Button
              variant="ghost"
              disabled={feedback.busy}
              onClick={() => {
                setConfirming(null);
              }}
            >
              {t("confirmCancel")}
            </Button>
            <Button
              variant="primary"
              tone="danger"
              data-tone="danger"
              disabled={feedback.busy}
              aria-busy={feedback.busy}
              onClick={() => {
                const target = confirming;
                if (target === null) return;
                feedback.run(remove(target.id), {
                  onSettled: () => {
                    setConfirming(null);
                  },
                  onSuccess: () => {
                    reloadRows();
                    focusHeading();
                  },
                });
              }}
            >
              {t("confirmAccept")}
            </Button>
          </>
        }
      />
      <Modal
        open={bulkArchiving}
        onClose={() => {
          setBulkArchiving(false);
        }}
        title={t("bulkArchive.confirmTitle")}
        closeLabel={t("close")}
        description={t("bulkArchive.confirmDescription")}
        footer={
          <>
            <Button
              variant="ghost"
              disabled={feedback.busy}
              onClick={() => {
                setBulkArchiving(false);
              }}
            >
              {t("confirmCancel")}
            </Button>
            <Button
              variant="primary"
              data-action="bulk-archive-confirm"
              disabled={feedback.busy}
              aria-busy={feedback.busy}
              onClick={() => {
                runBulkArchive([...selected]);
              }}
            >
              {t("bulkArchive.confirmAccept")}
            </Button>
          </>
        }
      />
      <Modal
        open={bulkConfirming}
        onClose={() => {
          setBulkConfirming(false);
        }}
        title={t("bulk.confirmTitle")}
        closeLabel={t("close")}
        tone="warning"
        description={t("bulk.confirmDescription")}
        footer={
          <>
            <Button
              variant="ghost"
              disabled={feedback.busy}
              onClick={() => {
                setBulkConfirming(false);
              }}
            >
              {t("confirmCancel")}
            </Button>
            <Button
              variant="primary"
              tone="danger"
              data-tone="danger"
              disabled={feedback.busy}
              aria-busy={feedback.busy}
              onClick={() => {
                runBulkDelete([...selected]);
              }}
            >
              {t("bulk.confirmAccept")}
            </Button>
          </>
        }
      />
      <Modal
        open={replacing !== null}
        onClose={() => {
          setReplacing(null);
        }}
        title={t("importReplaceTitle")}
        closeLabel={t("close")}
        tone="warning"
        description={t("importReplaceDescription")}
        footer={
          <>
            <Button
              variant="ghost"
              disabled={feedback.busy}
              onClick={() => {
                setReplacing(null);
              }}
            >
              {t("confirmCancel")}
            </Button>
            <Button
              variant="primary"
              tone="danger"
              data-tone="danger"
              disabled={feedback.busy}
              aria-busy={feedback.busy}
              onClick={() => {
                const target = replacing;
                if (target === null) return;
                setReplacing(null);
                importFile(target.file, {
                  sessionId: target.row.id,
                  success: t("importReplaced"),
                });
              }}
            >
              {t("importReplaceAccept")}
            </Button>
          </>
        }
      />
      <Modal
        open={copySource !== null}
        onClose={() => {
          setCopySource(null);
        }}
        title={t("copy.title")}
        closeLabel={t("close")}
        description={t("copy.description")}
        footer={
          <>
            <Button
              variant="ghost"
              disabled={feedback.busy}
              onClick={() => {
                setCopySource(null);
              }}
            >
              {t("confirmCancel")}
            </Button>
            <Button
              variant="primary"
              data-action="copy-confirm"
              disabled={feedback.busy || copyWorkspaceId === ""}
              aria-busy={feedback.busy}
              onClick={() => {
                const source = copySource;
                if (source === null || copyWorkspaceId === "") return;
                runCopy(source, copyWorkspaceId);
              }}
            >
              {t("copy.confirm")}
            </Button>
          </>
        }
      >
        {copyWorkspaces === null ? (
          <Text as="p" size="sm" tone="tertiary">
            {t("copy.loading")}
          </Text>
        ) : (
          <label className={frameCss.copyField}>
            <Text size="sm" tone="tertiary">
              {t("copy.workspace")}
            </Text>
            <select
              data-copy-workspace=""
              aria-label={t("copy.workspace")}
              value={copyWorkspaceId}
              onChange={(event) => {
                setCopyWorkspaceId(event.currentTarget.value);
              }}
            >
              <option value="">{t("copy.placeholder")}</option>
              {copyWorkspaces.map((workspace) => (
                <option key={workspace.workspaceId} value={workspace.workspaceId}>
                  {workspace.title}
                </option>
              ))}
            </select>
          </label>
        )}
      </Modal>
      <RepairModal
        title={repairing === null ? null : repairing.title}
        busy={feedback.busy}
        onCancel={() => {
          setRepairing(null);
        }}
        onAction={(action) => {
          const target = repairing;
          if (target === null) return;
          runRepair(target, action);
        }}
        t={t}
      />
      <LocateModal
        target={locating === null ? null : { id: locating.id, title: locating.title }}
        onLocate={locateEvents}
        describeFailure={describeFailure}
        onClose={() => {
          setLocating(null);
        }}
        t={t}
      />
      <Modal
        open={organizePhase === "confirm"}
        onClose={() => {
          setOrganizePhase("idle");
        }}
        title={t("organize.title")}
        closeLabel={t("close")}
        tone="warning"
        description={t("organize.description")}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setOrganizePhase("idle");
              }}
            >
              {t("organize.cancel")}
            </Button>
            <Button variant="primary" onClick={startOrganize}>
              {t("organize.confirm")}
            </Button>
          </>
        }
      />
      {/* 运行期不给关闭手段：没有关闭按钮，mask 与 Escape 都只走空 onClose。 */}
      <Modal
        open={organizePhase === "running"}
        onClose={() => {
          /* 运行期不可关闭：这条 onClose 必须是空实现。 */
        }}
        headless
        title={t("organize.title")}
      >
        <Stack align="center" gap={14} pad="blocking">
          <Spinner label={t("organize.running")} />
          <Text as="p" size="md">
            {t("organize.running")}
          </Text>
          <Text as="p" size="sm" tone="tertiary">
            {t("organize.uncancellable")}
          </Text>
        </Stack>
      </Modal>
    </section>
  );
}
