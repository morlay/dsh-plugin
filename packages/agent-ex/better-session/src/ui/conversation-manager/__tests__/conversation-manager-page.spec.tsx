// @vitest-environment happy-dom
// 页面闭环：列表、搜索下推、分页、子代理过滤、三种整屏状态，以及动作按钮只经注入面。
// 组件 spec 直喂 props（框架座位由本文件提供替身），几何在浏览器里核对，这里钉住结构与标注。
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationManagerPage } from "../conversation-manager-page.tsx";
import type { ConversationManagerFace } from "../conversation-manager.controller.ts";
import { ConversationManagerRequestError } from "../conversation-manager.controller.ts";
import { zh } from "../locales.ts";
import type { ConversationManagerKey } from "../locales.ts";

afterEach(cleanup);

const t = ((key: ConversationManagerKey, args?: Record<string, unknown>) => {
  const template: string = zh[key] ?? key;
  return args === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (_match: string, name: string) => String(args[name]));
}) as never;

interface Row {
  sessionId: string;
  title: string;
  updatedAt?: number;
  origin?: "subagent";
}

const A: Row = { sessionId: "s1", title: "会话 A", updatedAt: 3_000 };
const B: Row = { sessionId: "s2", title: "会话 B", updatedAt: 2_000 };
const C: Row = { sessionId: "s3", title: "会话 C", updatedAt: 1_000 };

const EMPTY_TOTALS = {
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

const EMPTY_REPORT = {
  totals: EMPTY_TOTALS,
  subagent: EMPTY_TOTALS,
  human: EMPTY_TOTALS,
  buckets: [],
  sessions: [],
};

// 后端语义的替身：搜索 / 子代理过滤 / 排序 / 分页都在「宿主」做。
function backendRows(rows: readonly Row[], archived: readonly string[]) {
  const archivedIds = new Set(archived);
  return async (query: Record<string, unknown> = {}) => {
    const needle = typeof query["query"] === "string" ? query["query"].toLowerCase() : "";
    const matched = rows
      .filter((row) => (query["includeSubagents"] === true ? true : row.origin !== "subagent"))
      .filter((row) => needle === "" || row.title.toLowerCase().includes(needle))
      .map((row) => ({
        sessionId: row.sessionId,
        title: row.title,
        origin: row.origin ?? null,
        cwd: null,
        createdAt: 0,
        updatedAt: row.updatedAt ?? Date.now(),
        archived: archivedIds.has(row.sessionId),
        workspace: row.sessionId === "s3" ? null : "工作区一",
      }))
      .sort((left, right) => right.updatedAt - left.updatedAt);
    const page = typeof query["page"] === "number" ? query["page"] : 1;
    const pageSize = typeof query["pageSize"] === "number" ? query["pageSize"] : 20;
    const start = (page - 1) * pageSize;
    return { items: matched.slice(start, start + pageSize), total: matched.length, page, pageSize };
  };
}

interface Bench {
  faces: Record<keyof ConversationManagerFace, ReturnType<typeof vi.fn>>;
  container: HTMLElement;
}

async function renderPage(options: {
  archived: readonly string[];
  sessions?: readonly Row[];
  listRows?: (query?: Record<string, unknown>) => Promise<unknown>;
  skipReady?: boolean;
  faces?: Partial<Record<keyof ConversationManagerFace, unknown>>;
}): Promise<Bench> {
  const rows = options.sessions ?? [A, B, C];
  const faces = {
    listRows: vi.fn(options.listRows ?? backendRows(rows, options.archived)),
    archive: vi.fn(async () => undefined),
    unarchive: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    exportZip: vi.fn(async () => undefined),
    importZip: vi.fn(async () => "session-new"),
    organizeData: vi.fn(async () => ({
      stoppedAgents: 0,
      orphanSessions: 0,
      orphanEvents: 0,
      rebuiltSessions: 0,
      vacuumed: true,
    })),
    loadUsage: vi.fn(async () => EMPTY_REPORT),
    ...options.faces,
  };
  const Page = ConversationManagerPage as unknown as (props: Record<string, unknown>) => ReactNode;
  const view = render(<Page t={t} {...faces} />);
  if (options.skipReady !== true) {
    await waitFor(() => {
      expect(screen.queryByText(zh.loading)).toBeNull();
    });
  }
  return { faces: faces as Bench["faces"], container: view.container };
}

function rowTexts(): string[] {
  return screen.queryAllByRole("listitem").map((row) => row.textContent ?? "");
}

describe("对话管理页：列表与搜索", () => {
  it("按最近活动降序列出会话，并把工作区摊平", async () => {
    await renderPage({ archived: [B.sessionId, C.sessionId] });
    expect(rowTexts()).toHaveLength(3);
    expect(rowTexts()[0]).toContain("会话 A");
    expect(rowTexts()[0]).toContain("工作区一");
    expect(rowTexts()[2]).toContain("未分组");
  });

  it("搜索下推到宿主，命中后只剩匹配的行", async () => {
    const bench = await renderPage({ archived: [B.sessionId, C.sessionId] });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "B" } });
    await waitFor(() => {
      expect(rowTexts()).toHaveLength(1);
    });
    expect(bench.faces.listRows).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: "B", page: 1 }),
    );
  });

  it("搜索无结果时给出空搜索文案，框架仍在", async () => {
    const bench = await renderPage({ archived: [B.sessionId, C.sessionId] });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });
    await waitFor(() => {
      expect(rowTexts()).toHaveLength(0);
    });
    expect(bench.container.querySelector('[data-status="empty-search"]')).not.toBeNull();
    expect(screen.getByText(zh.emptySearch)).toBeTruthy();
  });

  it("一份会话都没有时整屏居中，不画框架", async () => {
    const bench = await renderPage({ archived: [], sessions: [] });
    expect(bench.container.querySelector('[data-status="empty"]')).not.toBeNull();
    expect(screen.getByText(zh.empty)).toBeTruthy();
    expect(bench.container.querySelector("h1")).toBeNull();
  });

  it("默认不显示子代理会话，勾选后显示并带标记", async () => {
    const sub: Row = { sessionId: "s4", title: "子代理会话", updatedAt: 4_000, origin: "subagent" };
    await renderPage({ archived: [C.sessionId], sessions: [A, B, C, sub] });

    expect(rowTexts()).toHaveLength(3);
    expect(screen.queryByText("子代理会话")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: zh.showSubagents }));
    await waitFor(() => {
      expect(rowTexts()).toHaveLength(4);
    });
    expect(screen.getByText(zh.subagent)).toBeTruthy();
  });

  it("每页 20 条，翻页生效，搜索回到第一页", async () => {
    const many: Row[] = Array.from({ length: 25 }, (_unused, index) => ({
      sessionId: "s" + String(index),
      title: "会话 " + String(index),
    }));
    await renderPage({ archived: many.map((row) => row.sessionId), sessions: many });

    expect(rowTexts()).toHaveLength(20);
    expect(screen.getByText("第 1 / 2 页")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: zh["page.next"] }));
    await waitFor(() => {
      expect(screen.getByText("第 2 / 2 页")).toBeTruthy();
    });
    expect(rowTexts()).toHaveLength(5);

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "会话 1" } });
    await waitFor(() => {
      expect(screen.getByText("第 1 / 1 页")).toBeTruthy();
    });
  });

  it("读列表失败时整屏失败态并带 role=alert", async () => {
    const bench = await renderPage({
      archived: [],
      listRows: async () => {
        throw new ConversationManagerRequestError("boom", undefined);
      },
      skipReady: true,
    });
    await waitFor(() => {
      expect(bench.container.querySelector('[data-status="failure"]')).not.toBeNull();
    });
    expect(bench.container.querySelector('[role="alert"]')?.textContent).toContain("boom");
    expect(bench.container.querySelector("h1")).toBeNull();
  });
});

describe("对话管理页：动作", () => {
  it("归档与取消归档互斥，删除只对已归档可用", async () => {
    const bench = await renderPage({ archived: [C.sessionId] });
    expect(screen.getAllByText(zh.archived)).toHaveLength(1);

    const disabled = (name: string): boolean =>
      (screen.getByRole("button", { name }) as HTMLButtonElement).disabled;

    expect(screen.queryByRole("button", { name: "取消归档 会话 A" })).toBeNull();
    expect(disabled("删除 会话 A")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "归档 会话 A" }));
    await waitFor(() => {
      expect(bench.faces.archive).toHaveBeenCalledWith("s1");
    });

    expect(screen.queryByRole("button", { name: "归档 会话 C" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "取消归档 会话 C" }));
    await waitFor(() => {
      expect(bench.faces.unarchive).toHaveBeenCalledWith("s3");
    });
  });

  it("删除先弹确认，未确认前不请求", async () => {
    const bench = await renderPage({ archived: [C.sessionId] });
    fireEvent.click(screen.getByRole("button", { name: "删除 会话 C" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain(zh.confirmTitle);
    expect(bench.faces.remove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: zh.confirmAccept }));
    await waitFor(() => {
      expect(bench.faces.remove).toHaveBeenCalledWith("s3");
    });
  });

  it("确认弹窗可以取消", async () => {
    const bench = await renderPage({ archived: [C.sessionId] });
    fireEvent.click(screen.getByRole("button", { name: "删除 会话 C" }));
    fireEvent.click(await screen.findByRole("button", { name: zh.confirmCancel }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(bench.faces.remove).not.toHaveBeenCalled();
  });

  it("删除被宿主拒绝时给出可读原因", async () => {
    await renderPage({
      archived: [C.sessionId],
      faces: {
        remove: vi.fn(async () => {
          throw new ConversationManagerRequestError("not archived", "SESSION_NOT_ARCHIVED");
        }),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "删除 会话 C" }));
    fireEvent.click(await screen.findByRole("button", { name: zh.confirmAccept }));
    await waitFor(() => {
      expect(screen.getByText(zh["failure.notArchived"])).toBeTruthy();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("导入 zip 为新会话并提示结果", async () => {
    const bench = await renderPage({ archived: [] });
    const input = bench.container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("missing file input");
    const file = new File([new Uint8Array([1])], "session.zip", { type: "application/zip" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      expect(bench.faces.importZip).toHaveBeenCalledWith(file);
    });
    await waitFor(() => {
      expect(screen.getByText(zh.imported)).toBeTruthy();
    });
  });

  it("行内导出调用注入面", async () => {
    const bench = await renderPage({ archived: [C.sessionId] });
    fireEvent.click(screen.getByRole("button", { name: "导出 会话 C" }));
    await waitFor(() => {
      expect(bench.faces.exportZip).toHaveBeenCalledWith("s3");
    });
  });

  it("整理数据先确认，执行期间阻塞界面且没有关闭按钮", async () => {
    const gate = Promise.withResolvers<{
      stoppedAgents: number;
      orphanSessions: number;
      orphanEvents: number;
      rebuiltSessions: number;
      vacuumed: boolean;
    }>();
    const bench = await renderPage({
      archived: [],
      faces: { organizeData: vi.fn(() => gate.promise) },
    });

    fireEvent.click(screen.getByRole("button", { name: zh["organize.button"] }));
    const confirm = await screen.findByRole("dialog");
    expect(confirm.textContent).toContain("停止所有运行中的 Agent");
    expect(bench.faces.organizeData).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: zh["organize.confirm"] }));
    await waitFor(() => {
      expect(screen.getAllByText(zh["organize.running"]).length).toBeGreaterThan(0);
    });
    expect(screen.queryByRole("button", { name: zh.close })).toBeNull();

    gate.resolve({
      stoppedAgents: 2,
      orphanSessions: 3,
      orphanEvents: 12,
      rebuiltSessions: 5,
      vacuumed: true,
    });
    await waitFor(() => {
      expect(
        screen.getByText("已回收 3 条孤儿会话、12 行孤儿数据，并重算 5 个会话的统计数据。"),
      ).toBeTruthy();
    });
    expect(bench.faces.organizeData).toHaveBeenCalledTimes(1);
  });
});

const TOTALS_165 = {
  turns: 2,
  steps: 2,
  userInputs: 2,
  toolCalls: 1,
  inputTokens: 100,
  outputTokens: 65,
  cacheReadTokens: 0,
  reasoningTokens: 0,
  totalTokens: 165,
};
const TOTALS_55 = {
  turns: 1,
  steps: 1,
  userInputs: 1,
  toolCalls: 0,
  inputTokens: 0,
  outputTokens: 55,
  cacheReadTokens: 0,
  reasoningTokens: 0,
  totalTokens: 55,
};

const REPORT = {
  totals: TOTALS_165,
  subagent: TOTALS_55,
  human: TOTALS_165,
  buckets: [
    {
      day: "2026-09-08",
      provider: "deepseek-official",
      model: "v4",
      subagent: false,
      ...TOTALS_165,
    },
    { day: "2026-09-08", provider: "deepseek-official", model: "v4", subagent: true, ...TOTALS_55 },
  ],
  sessions: [
    { sessionId: "s1", title: "会话 A", subagent: false, archived: false, ...TOTALS_165 },
    { sessionId: "s4", title: "子代理会话", subagent: true, archived: false, ...TOTALS_55 },
  ],
};

describe("对话管理页：token 用量统计", () => {
  it("切到统计拉一次数据，默认总览含子代理拆分", async () => {
    const bench = await renderPage({
      archived: [],
      faces: { loadUsage: vi.fn(async () => REPORT) },
    });
    fireEvent.click(screen.getByRole("button", { name: zh["view.usage"] }));
    await waitFor(() => {
      expect(bench.faces.loadUsage).toHaveBeenCalledTimes(1);
    });
    expect(bench.faces.loadUsage).toHaveBeenCalledWith("day");
    expect(screen.getByText(zh["usage.all"])).toBeTruthy();
    expect(screen.getByText(zh["usage.subagentOnly"])).toBeTruthy();
    expect(bench.container.querySelector('[data-usage-cell="total"]')).toBeNull();
  });

  it("二层切维度，时间范围切换会带参数重新请求", async () => {
    const loadUsage = vi.fn(async () => REPORT);
    await renderPage({ archived: [], faces: { loadUsage } });
    fireEvent.click(screen.getByRole("button", { name: zh["view.usage"] }));
    await screen.findByText(zh["usage.all"]);

    fireEvent.click(screen.getByRole("button", { name: zh["usage.models"] }));
    expect(screen.getByText("deepseek-official / v4")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: zh["usage.sessions"] }));
    expect(screen.getByText("会话 A")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: zh["usage.range.days"].replace("{n}", "7") }),
    );
    await waitFor(() => {
      expect(loadUsage).toHaveBeenLastCalledWith("7d");
    });
    fireEvent.click(screen.getByRole("button", { name: zh["usage.range.week"] }));
    await waitFor(() => {
      expect(loadUsage).toHaveBeenLastCalledWith("week");
    });
  });

  it("输入在显示上含缓存读取，命中率是缓存占总输入的比例", async () => {
    const withCache = {
      ...REPORT,
      totals: { ...TOTALS_165, cacheReadTokens: 1_000 },
      subagent: { ...TOTALS_55 },
    };
    const bench = await renderPage({
      archived: [],
      faces: { loadUsage: vi.fn(async () => withCache) },
    });
    fireEvent.click(screen.getByRole("button", { name: zh["view.usage"] }));
    await screen.findByText(zh["usage.all"]);

    const metric = (key: string): string | null | undefined =>
      bench.container
        .querySelector('[data-usage-cell="' + key + '"]')
        ?.getAttribute("data-usage-value");
    expect(metric("input")).toBe("1100");
    expect(screen.getByText("1.1K")).toBeTruthy();
    expect(metric("cacheInput")).toBe("1000");
    expect(Number(metric("cacheRate"))).toBeCloseTo(90.9, 1);
  });

  it("按模型把子代理的桶合进同一行", async () => {
    const bench = await renderPage({
      archived: [],
      faces: { loadUsage: vi.fn(async () => REPORT) },
    });
    fireEvent.click(screen.getByRole("button", { name: zh["view.usage"] }));
    await screen.findByText(zh["usage.all"]);
    fireEvent.click(screen.getByRole("button", { name: zh["usage.models"] }));

    expect(
      bench.container.querySelectorAll('[data-usage-key="deepseek-official / v4"]').length,
    ).toBe(1);
    expect(
      bench.container.querySelector('[data-usage-cell="output"]')?.getAttribute("data-usage-value"),
    ).toBe("120");
  });

  it("按模型的行不显示活动计数（事件没有模型归属）", async () => {
    const bench = await renderPage({
      archived: [],
      faces: { loadUsage: vi.fn(async () => REPORT) },
    });
    fireEvent.click(screen.getByRole("button", { name: zh["view.usage"] }));
    await screen.findByText(zh["usage.all"]);
    fireEvent.click(screen.getByRole("button", { name: zh["usage.models"] }));
    expect(bench.container.querySelector('[data-usage-cell="turns"]')).toBeNull();
    expect(bench.container.querySelector('[data-usage-cell="output"]')).not.toBeNull();
  });

  it("按会话标出子代理，并可只看子代理", async () => {
    const bench = await renderPage({
      archived: [],
      faces: { loadUsage: vi.fn(async () => REPORT) },
    });
    fireEvent.click(screen.getByRole("button", { name: zh["view.usage"] }));
    await screen.findByText(zh["usage.all"]);
    expect(screen.queryByRole("button", { name: zh["usage.onlySubagents"] })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: zh["usage.sessions"] }));
    const subagentRow = bench.container.querySelector('[data-usage-key="s4"]');
    expect(subagentRow?.getAttribute("data-subagent")).toBe("true");
    expect(within(subagentRow as HTMLElement).getByText(zh.subagent)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: zh["usage.onlySubagents"] }));
    expect(bench.container.querySelector('[data-usage-key="s1"]')).toBeNull();
    expect(bench.container.querySelector('[data-usage-key="s4"]')).not.toBeNull();
  });

  it("统计失败时给出原因", async () => {
    await renderPage({
      archived: [],
      faces: {
        loadUsage: vi.fn(async () => {
          throw new ConversationManagerRequestError("boom", undefined);
        }),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: zh["view.usage"] }));
    await waitFor(() => {
      expect(screen.getByText("操作失败：boom")).toBeTruthy();
    });
  });
});

describe("对话管理页：框架与状态态", () => {
  it("标题行、过滤行、搜索行与列表在同一个滚动层里", async () => {
    const bench = await renderPage({ archived: [B.sessionId] });
    const scroll = bench.container.querySelector('[data-scroll="page"]');
    expect(scroll).not.toBeNull();
    expect(scroll!.querySelector("h1")?.textContent).toBe(zh.title);
    expect(scroll!.querySelector('[data-action="import"]')).not.toBeNull();
    expect(scroll!.querySelector('[data-filter="search"]')).not.toBeNull();
    expect(scroll!.querySelector("[data-session-id]")).not.toBeNull();
    expect(scroll!.querySelector("[data-pagination]")).not.toBeNull();
  });

  it("过滤 chip 用 aria-pressed 说选中", async () => {
    const bench = await renderPage({ archived: [C.sessionId] });
    const group = bench.container.querySelector('[data-filter="subagents"]');
    expect(group?.getAttribute("role")).toBe("group");
    const chip = within(group as HTMLElement).getByRole("button", { name: zh.showSubagents });
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
  });

  it("清空按钮只在有查询时出现，点了清空并还原列表", async () => {
    await renderPage({ archived: [B.sessionId, C.sessionId] });
    expect(screen.queryByRole("button", { name: zh.clearSearch })).toBeNull();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "B" } });
    await waitFor(() => {
      expect(rowTexts()).toHaveLength(1);
    });
    fireEvent.click(screen.getByRole("button", { name: zh.clearSearch }));
    await waitFor(() => {
      expect(rowTexts()).toHaveLength(3);
    });
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
  });

  it("读取中：状态占满面板并居中，此时不画标题行与搜索行", async () => {
    const bench = await renderPage({
      archived: [B.sessionId],
      listRows: () => new Promise(() => {}),
      skipReady: true,
    });
    const status = bench.container.querySelector('[data-status="loading"]');
    expect(status?.querySelector('[role="status"]')).not.toBeNull();
    expect(screen.getByText(zh.loading)).toBeTruthy();
    expect(bench.container.querySelector("h1")).toBeNull();
    expect(bench.container.querySelector('[data-filter="search"]')).toBeNull();
  });
});
