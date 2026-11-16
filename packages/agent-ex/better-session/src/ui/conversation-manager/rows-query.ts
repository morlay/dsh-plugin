// 列表查询状态：搜索（停 250ms 再下推）、子代理筛选、页码、取数在途、失败保留旧行、
// 过期响应丢弃与页码夹取都在这里；页面只从这个返回值渲染。
//
// 请求身份是自增的：只有最后发出的那次响应能落到界面上（慢的旧响应会覆盖新响应）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  SessionRowsItem,
  SessionRowsRequest,
  SessionRowsSearchStage,
} from "@morlay/better-session/endpoint";
import type { ConversationManagerFace } from "./conversation-manager.controller.ts";
import { failureCopy, failureText } from "./failure.ts";
import type { ConversationManagerTranslate } from "./locales.ts";

// 一页的行数（会话列表）。
export const PAGE_SIZE = 20;

// 时间筛选：全部 / 最近 7 个自然日 / 最近 30 个自然日（映射成宿主的 updatedAfter）。
export type ConversationTimeFilter = "all" | "7d" | "30d";

// 本地自然日的零点：与宿主统计（`data/usage.ts` 的 `localDayKey` 口径）同一条边界——host 本地时区的 00:00。
function localDayStart(now: number): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
}

/**
 * 时间筛选的下界：「最近 N 个自然日」的起点（含今天共 N 天）= 今天零点往前 N-1 天。
 *
 * 用日历日回退（不是减 N × 24h）：跨夏令时切换时「N-1 天前的零点」才是本地零点；与宿主
 * `resolveUsageSince` 的 `7d` / `30d` 同一口径，统计与会话列表因此圈的是同一段日子。
 * @param now - 当前时刻（毫秒）。
 * @param days - 自然日天数（至少 1）。
 * @returns 窗口起点（毫秒，本地零点）。
 */
export function localDayWindowStart(now: number, days: number): number {
  const start = localDayStart(now);
  start.setDate(start.getDate() - (Math.max(days, 1) - 1));
  return start.getTime();
}

// 归档筛选：全部 / 只看已归档 / 只看未归档。
export type ConversationArchivedFilter = "all" | "only" | "unarchived";

// 搜索输入停多久再下推给宿主。
const SEARCH_DEBOUNCE_MS = 250;

interface RowsPage {
  readonly items: readonly SessionRowsItem[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly searchStage?: SessionRowsSearchStage | undefined;
}

// 页面用的行形状：标题已兜底、工作区已摊平。
export interface ConversationRow {
  readonly id: string;
  readonly title: string;
  // 所属工作区标题；不在任何工作区里的会话用未分组文案。
  readonly workspace: string;
  // 只有已归档的行允许取消归档与删除（宿主侧同样守卫）。
  readonly archived: boolean;
  // 子代理派生会话：默认不显示。
  readonly subagent: boolean;
  readonly updatedAt: number;
}

export interface RowsQuery {
  readonly rows: readonly ConversationRow[];
  // 第一页已经落地（否则页面画整屏读取 / 失败态）。
  readonly ready: boolean;
  // 有取数在途。
  readonly loading: boolean;
  // 刷新失败：旧行仍在，横幅给重试。
  readonly failure: string | null;
  readonly query: string;
  readonly settledQuery: string;
  readonly showSubagents: boolean;
  readonly timeFilter: ConversationTimeFilter;
  readonly archivedFilter: ConversationArchivedFilter;
  // 当前筛选（不含分页）：批量导出等动作要的正是与列表同一组条件。
  readonly filters: SessionRowsRequest;
  // 搜索实际走的段（宿主回报）：前缀没命中才退全文。
  readonly searchStage: SessionRowsSearchStage;
  // 夹在 `1..pageCount` 里的当前页（末页被删空时不会停在空页）。
  readonly currentPage: number;
  readonly pageCount: number;
  // 取数落地后的播报（翻页、搜索、筛选变化都算）。
  readonly announcement: string | null;
  setQuery: (value: string) => void;
  clearQuery: () => void;
  toggleSubagents: () => void;
  setTimeFilter: (filter: ConversationTimeFilter) => void;
  setArchivedFilter: (filter: ConversationArchivedFilter) => void;
  goToPage: (page: number) => void;
  reload: () => Promise<void>;
}

// 页码的兜底：至少一页，且当前页不超过末页。
function pageCountOf(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

export function useRowsQuery(
  face: Pick<ConversationManagerFace, "listRows">,
  t: ConversationManagerTranslate,
): RowsQuery {
  const { listRows } = face;
  const [rowsPage, setRowsPage] = useState<RowsPage | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQueryState] = useState("");
  const [settledQuery, setSettledQuery] = useState("");
  const [showSubagents, setShowSubagents] = useState(false);
  const [timeFilter, setTimeFilterState] = useState<ConversationTimeFilter>("all");
  const [archivedFilter, setArchivedFilterState] = useState<ConversationArchivedFilter>("all");
  const [page, setPage] = useState(1);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const requestId = useRef(0);
  const copy = useMemo(() => failureCopy(t), [t]);

  const days = timeFilter === "7d" ? 7 : timeFilter === "30d" ? 30 : 0;
  // 时间窗在筛选变化时钉住（不是在每次请求时重算）：列表与批量导出用的是同一个窗口。
  // 下界是**本地自然日的零点**（近 7 天 = 今天零点往前 6 天），不是此刻往前 N × 24h。
  const updatedAfter = useMemo(
    () => (days === 0 ? undefined : localDayWindowStart(Date.now(), days)),
    [days],
  );
  const filters = useMemo<SessionRowsRequest>(
    () => ({
      ...(settledQuery === "" ? {} : { query: settledQuery }),
      ...(showSubagents ? { includeSubagents: true } : {}),
      ...(updatedAfter === undefined ? {} : { updatedAfter }),
      ...(archivedFilter === "all" ? {} : { archived: archivedFilter }),
    }),
    [settledQuery, showSubagents, updatedAfter, archivedFilter],
  );

  const reload = useCallback(async (): Promise<void> => {
    const current = ++requestId.current;
    const requestedPage = page;
    setLoading(true);
    const request: SessionRowsRequest = { ...filters, page: requestedPage, pageSize: PAGE_SIZE };
    try {
      const next = await listRows(request);
      if (current !== requestId.current) return;
      setRowsPage(next);
      setFailure(null);
      const lastPage = pageCountOf(next.total);
      setAnnouncement(t("page.announce", { page: next.page, total: lastPage, count: next.total }));
      // 末页被删空时把页码拉回最后一页：否则 total > 0 而本页没有行，列表与分页条一起消失。
      if (requestedPage > lastPage) setPage(lastPage);
    } catch (error: unknown) {
      if (current !== requestId.current) return;
      setFailure(failureText(error, copy));
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, [listRows, copy, t, filters, page]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 搜索下推到宿主：输入停一下再请求（每次按键都打宿主没必要）。
  useEffect(() => {
    if (query === settledQuery) return;
    const timer = window.setTimeout(() => {
      setSettledQuery(query);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [query, settledQuery]);

  const setQuery = useCallback((value: string) => {
    setQueryState(value);
    setPage(1);
  }, []);

  const clearQuery = useCallback(() => {
    setQueryState("");
    setPage(1);
  }, []);

  const toggleSubagents = useCallback(() => {
    setShowSubagents((shown) => !shown);
    setPage(1);
  }, []);

  const setTimeFilter = useCallback((next: ConversationTimeFilter) => {
    setTimeFilterState(next);
    setPage(1);
  }, []);

  const setArchivedFilter = useCallback((next: ConversationArchivedFilter) => {
    setArchivedFilterState(next);
    setPage(1);
  }, []);

  const goToPage = useCallback((next: number) => {
    setPage(next);
  }, []);

  const ungrouped = t("ungrouped");
  const rows = useMemo<ConversationRow[]>(
    () =>
      (rowsPage?.items ?? []).map((record) => ({
        id: record.sessionId,
        title: record.title ?? record.sessionId,
        workspace: record.workspace ?? ungrouped,
        archived: record.archived,
        subagent: record.origin === "subagent",
        updatedAt: record.updatedAt,
      })),
    [rowsPage, ungrouped],
  );

  const pageCount = pageCountOf(rowsPage?.total ?? 0);
  const currentPage = Math.min(page, pageCount);

  return {
    rows,
    ready: rowsPage !== null,
    loading,
    failure,
    query,
    settledQuery,
    showSubagents,
    timeFilter,
    archivedFilter,
    filters,
    searchStage: rowsPage?.searchStage ?? "none",
    currentPage,
    pageCount,
    announcement,
    setQuery,
    clearQuery,
    toggleSubagents,
    setTimeFilter,
    setArchivedFilter,
    goToPage,
    reload,
  };
}
