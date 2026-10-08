// @vitest-environment jsdom
// 列表与搜索闭环：页面只列已归档会话（最近归档在前），搜索同时匹配标题与所属工作区名，
// 三种空态各自的文案由数据形状决定。
// 动作闭环：取消归档 / 删除 / 导入都只经注入面；删除必须先过确认弹窗；
// host 拒绝时把错误码翻成可读文案。
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { ConversationManagerPage } from "../client/ConversationManagerPage.tsx";
import frameCss from "../client/ConversationManagerPage.module.css";
import { ConversationManagerRequestError } from "../client/controller.ts";
import { zh } from "../client/locales.ts";

afterEach(cleanup);

const t = ((key: string, args?: Record<string, unknown>) => {
  const template: string = zh[key as keyof typeof zh] ?? key;
  return args === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (_match: string, name: string) => String(args[name]));
}) as never;

// 框架 hook 的替身：一个固定快照的 selector 座位。
function hook<T>(value: T): never {
  return ((selector: (state: T) => unknown) => selector(value)) as never;
}

interface Row {
  id: string;
  title: string;
  // 最近活动时间：列表按它降序。
  updatedAt?: number;
  // 子代理派生会话：默认不显示，勾选后显示并带标记。
  origin?: "subagent";
}

interface Faces {
  listRows: ReturnType<typeof vi.fn>;
  archive: ReturnType<typeof vi.fn>;
  unarchive: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  importZip: ReturnType<typeof vi.fn>;
  exportZip: ReturnType<typeof vi.fn>;
  collectGarbage: ReturnType<typeof vi.fn>;
  loadUsage: ReturnType<typeof vi.fn>;
}

const EMPTY_TOTALS = {
  events: 0,
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

const A: Row = { id: "s1", title: "会话 A", updatedAt: 3_000 };
const B: Row = { id: "s2", title: "会话 B", updatedAt: 2_000 };
const C: Row = { id: "s3", title: "会话 C", updatedAt: 1_000 };

async function renderPage(options: {
  archived: readonly string[];
  sessions?: readonly Row[];
  workspaces?: readonly { id: string; title: string; sessionIds: readonly string[] }[];
  // 列表路由的替身：给了就覆盖默认的「会话行快照」实现（用于失败态 / 未就绪用例）。
  listRows?: () => Promise<unknown>;
  // 未就绪用例要自己断言 loading 文案：跳过「等列表就绪」这一步。
  skipReady?: boolean;
  faces?: Partial<Faces>;
}): Promise<{ faces: Faces; container: HTMLElement }> {
  const rows = options.sessions ?? [A, B, C];
  const workspaces = options.workspaces ?? [
    { id: "w1", title: "工作区一", sessionIds: [A.id, B.id] },
  ];
  const archivedIds = new Set(options.archived);
  const ownerOf = new Map<string, string>();
  for (const workspace of workspaces) {
    for (const id of workspace.sessionIds) ownerOf.set(id, workspace.title);
  }
  const allRows = rows.map((row) => ({
    sessionId: row.id,
    title: row.title,
    origin: row.origin ?? null,
    cwd: null,
    createdAt: 0,
    updatedAt: row.updatedAt ?? Date.now(),
    archived: archivedIds.has(row.id),
    workspace: ownerOf.get(row.id) ?? null,
  }));
  const faces: Faces = {
    // 数据面是我们自己的列表路由：替身按后端语义办事（搜索 / 子代理过滤 / 分页都在「后端」）。
    listRows: vi.fn(
      options.listRows ??
        (async (query: Record<string, unknown> = {}) => {
          const needle = typeof query["query"] === "string" ? query["query"].toLowerCase() : "";
          const filtered = allRows
            .filter((row) =>
              query["includeSubagents"] === true ? true : row.origin !== "subagent",
            )
            .filter(
              (row) =>
                needle === "" ||
                row.title.toLowerCase().includes(needle) ||
                (row.workspace ?? "").toLowerCase().includes(needle),
            );
          filtered.sort((left, right) => right.updatedAt - left.updatedAt);
          const page = typeof query["page"] === "number" ? query["page"] : 1;
          const pageSize = typeof query["pageSize"] === "number" ? query["pageSize"] : 20;
          const start = (page - 1) * pageSize;
          return {
            items: filtered.slice(start, start + pageSize),
            total: filtered.length,
            page,
            pageSize,
          };
        }),
    ),
    archive: vi.fn(async () => {}),
    unarchive: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    importZip: vi.fn(async () => "session-new"),
    exportZip: vi.fn(async () => {}),
    collectGarbage: vi.fn(async () => ({ orphanSessions: 0, orphanEvents: 0, stoppedAgents: 0 })),
    loadUsage: vi.fn(async () => EMPTY_REPORT),
    ...options.faces,
  };
  // 组件 spec 直喂 props：main 座位的框架座位由本文件提供替身。
  const Page = ConversationManagerPage as unknown as (props: Record<string, unknown>) => ReactNode;
  const view = render(
    <Page
      t={t}
      useWorkspaces={hook({ items: workspaces, archivedSessionIds: options.archived })}
      usePanelInfo={hook({ activePanelId: "conversations" })}
      renderSlot={() => null}
      {...faces}
    />,
  );
  // 列表是异步拉的：等 loading 文案消失再交回控制权（空列表同样适用）。
  if (options.skipReady !== true) {
    await waitFor(() => {
      expect(screen.queryByText(zh.loading)).toBeNull();
    });
  }
  return { faces, container: view.container };
}

function rowTexts(): string[] {
  return screen.queryAllByRole("listitem").map((row) => row.textContent ?? "");
}

function fileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("missing file input");
  return input;
}

describe("对话管理页面：列表与搜索", () => {
  it("列出全部会话，按最近活动在前", async () => {
    await renderPage({ archived: [B.id, C.id] });
    expect(rowTexts()).toHaveLength(3);
    expect(rowTexts()[0]).toContain("会话 A");
    expect(rowTexts()[1]).toContain("会话 B");
    expect(rowTexts()[2]).toContain("会话 C");
  });

  it("行显示所属工作区，归档会话按未分组显示", async () => {
    await renderPage({ archived: [B.id, C.id] });
    expect(rowTexts()[0]).toContain("工作区一");
    expect(rowTexts()[1]).toContain("工作区一");
    expect(rowTexts()[2]).toContain("未分组");
  });

  it("搜索按标题过滤", async () => {
    await renderPage({ archived: [B.id, C.id] });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "B" } });
    // 搜索下推给 host：输入停 250ms 才请求，等结果回来再断言。
    await waitFor(() => {
      expect(rowTexts()).toHaveLength(1);
    });
    expect(rowTexts()[0]).toContain("会话 B");
  });

  it("搜索按所属工作区名过滤", async () => {
    await renderPage({ archived: [B.id, C.id] });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "工作区" } });
    await waitFor(() => {
      expect(rowTexts()).toHaveLength(2);
    });
    expect(rowTexts()[0]).toContain("会话 A");
    expect(rowTexts()[1]).toContain("会话 B");
  });

  it("搜索无结果时给出空搜索文案", async () => {
    await renderPage({ archived: [B.id, C.id] });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });
    await waitFor(() => {
      expect(rowTexts()).toHaveLength(0);
    });
    expect(screen.getByText("没有匹配的会话。")).toBeTruthy();
  });

  it("没有任何会话时给出空态", async () => {
    await renderPage({ archived: [], sessions: [], workspaces: [] });
    expect(screen.getByText("暂无会话。")).toBeTruthy();
  });

  it("归档与取消归档互斥，删除只对已归档可用", async () => {
    const { faces } = await renderPage({ archived: [C.id] });
    expect(screen.getAllByText("已归档")).toHaveLength(1);

    const disabled = (name: string): boolean =>
      (screen.getByRole("button", { name }) as HTMLButtonElement).disabled;

    // 未归档行：可归档、可导出；不能删除，也不提供取消归档。
    expect(screen.queryByRole("button", { name: "取消归档 会话 A" })).toBeNull();
    expect(disabled("导出 会话 A")).toBe(false);
    expect(disabled("删除 会话 A")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "归档 会话 A" }));
    await waitFor(() => {
      expect(faces.archive).toHaveBeenCalledWith("s1");
    });

    // 已归档行：可取消归档、可删除；不提供归档。
    expect(screen.queryByRole("button", { name: "归档 会话 C" })).toBeNull();
    expect(disabled("取消归档 会话 C")).toBe(false);
    expect(disabled("删除 会话 C")).toBe(false);
  });

  it("默认不显示子代理会话，勾选后显示并带标记", async () => {
    const sub: Row = { id: "s4", title: "子代理会话", updatedAt: 4_000, origin: "subagent" };
    await renderPage({ archived: [C.id], sessions: [A, B, C, sub] });

    // 全量数据在手，但默认隐藏子代理派生会话：它们既不可删除也不可取消归档。
    expect(rowTexts()).toHaveLength(3);
    expect(screen.queryByText("子代理会话")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "显示子代理会话" }));
    await waitFor(() => {
      expect(rowTexts()).toHaveLength(4);
    });
    expect(rowTexts()[0]).toContain("子代理会话");
    expect(screen.getByText("子代理")).toBeTruthy();
  });

  it("会话列表未就绪时给出读取文案", async () => {
    await renderPage({
      archived: [B.id],
      listRows: () => new Promise(() => {}),
      skipReady: true,
    });
    expect(screen.getByText("正在读取会话…")).toBeTruthy();
  });
});

describe("对话管理页面：动作", () => {
  it("取消归档调用注入面", async () => {
    const { faces } = await renderPage({ archived: [B.id, C.id] });
    fireEvent.click(screen.getByRole("button", { name: "取消归档 会话 C" }));
    await waitFor(() => {
      expect(faces.unarchive).toHaveBeenCalledWith("s3");
    });
  });

  it("删除先弹确认，未确认前不请求", async () => {
    const { faces } = await renderPage({ archived: [C.id] });
    fireEvent.click(screen.getByRole("button", { name: "删除 会话 C" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("删除会话");
    expect(dialog.textContent).toContain("删除后无法恢复：该会话的内容会从存储中移除。");
    expect(faces.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => {
      expect(faces.remove).toHaveBeenCalledWith("s3");
    });
  });

  it("确认弹窗可以取消", async () => {
    const { faces } = await renderPage({ archived: [C.id] });
    fireEvent.click(screen.getByRole("button", { name: "删除 会话 C" }));
    fireEvent.click(await screen.findByRole("button", { name: "取消" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(faces.remove).not.toHaveBeenCalled();
  });

  it("删除被 host 拒绝时给出可读原因", async () => {
    await renderPage({
      archived: [C.id],
      faces: {
        remove: vi.fn(async () => {
          throw new ConversationManagerRequestError(
            "session is not archived",
            "SESSION_NOT_ARCHIVED",
          );
        }),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "删除 会话 C" }));
    fireEvent.click(await screen.findByRole("button", { name: "删除" }));
    await waitFor(() => {
      expect(screen.getByText("只有已归档的会话可以删除。")).toBeTruthy();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("导入 zip 为新会话并提示结果", async () => {
    const { faces, container } = await renderPage({ archived: [] });
    const file = new File([new Uint8Array([1])], "session.zip", { type: "application/zip" });
    fireEvent.change(fileInput(container), { target: { files: [file] } });
    await waitFor(() => {
      expect(faces.importZip).toHaveBeenCalledWith(file);
    });
    await waitFor(() => {
      expect(screen.getByText("已导入为新会话。")).toBeTruthy();
    });
  });

  it("导入失败时给出原因", async () => {
    const { container } = await renderPage({
      archived: [],
      faces: {
        importZip: vi.fn(async () => {
          throw new ConversationManagerRequestError(
            "imported zip has no session log artifact",
            undefined,
          );
        }),
      },
    });
    fireEvent.change(fileInput(container), {
      target: { files: [new File([new Uint8Array([0])], "bad.zip")] },
    });
    await waitFor(() => {
      expect(screen.getByText("操作失败：imported zip has no session log artifact")).toBeTruthy();
    });
  });
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("对话管理页面：分页、导出与 GC", () => {
  it("搜索框复用官方 Input（官方包裹层 + 官方图标），不自造输入外观", async () => {
    await renderPage({ archived: [C.id] });
    const input = screen.getByRole("searchbox");
    const wrap = input.parentElement;
    // 官方 Input 的 DOM 是 wrap(span) > icon(span>svg) + input：手写 <input> 会被这条断言拦住。
    expect(wrap?.tagName).toBe("SPAN");
    expect(wrap?.querySelector("svg")).toBeTruthy();
    expect(input.getAttribute("style")).toBeNull();
  });

  it("每页 20 条，翻页生效，搜索回到第一页", async () => {
    const many: Row[] = Array.from({ length: 25 }, (_unused, index) => ({
      id: `s${index}`,
      title: `会话 ${index}`,
    }));
    await renderPage({ archived: many.map((row) => row.id), sessions: many });

    expect(rowTexts()).toHaveLength(20);
    expect(screen.getByText("第 1 / 2 页")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => {
      expect(screen.getByText("第 2 / 2 页")).toBeTruthy();
    });
    expect(rowTexts()).toHaveLength(5);

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "会话 1" } });
    await waitFor(() => {
      expect(screen.getByText("第 1 / 1 页")).toBeTruthy();
    });
    expect(rowTexts()).toHaveLength(11);
  });

  it("行内导出调用注入面", async () => {
    const { faces } = await renderPage({ archived: [C.id] });
    fireEvent.click(screen.getByRole("button", { name: "导出 会话 C" }));
    await waitFor(() => {
      expect(faces.exportZip).toHaveBeenCalledWith("s3");
    });
  });

  it("导出失败时给出原因", async () => {
    const { faces } = await renderPage({
      archived: [C.id],
      faces: {
        exportZip: vi.fn(async () => {
          throw new ConversationManagerRequestError("boom", undefined);
        }),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "导出 会话 C" }));
    await waitFor(() => {
      expect(screen.getByText("操作失败：boom")).toBeTruthy();
    });
    expect(faces.exportZip).toHaveBeenCalled();
  });

  it("清理孤儿数据先确认，执行期间阻塞界面且没有关闭按钮", async () => {
    const pending = deferred<{
      orphanSessions: number;
      orphanEvents: number;
      stoppedAgents: number;
    }>();
    const { faces } = await renderPage({
      archived: [],
      faces: { collectGarbage: vi.fn(() => pending.promise) },
    });

    fireEvent.click(screen.getByRole("button", { name: "清理孤儿数据" }));
    const confirm = await screen.findByRole("dialog");
    expect(confirm.textContent).toContain("停止所有运行中的 Agent");
    expect(faces.collectGarbage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "开始清理" }));
    await waitFor(() => {
      expect(screen.getByText("正在清理，请稍候…")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "关闭" })).toBeNull();
    expect(screen.queryByRole("button", { name: "取消" })).toBeNull();

    pending.resolve({ orphanSessions: 3, orphanEvents: 12, stoppedAgents: 2 });
    await waitFor(() => {
      expect(screen.getByText("已回收 3 条孤儿会话、12 行孤儿数据。")).toBeTruthy();
    });
    expect(faces.collectGarbage).toHaveBeenCalledTimes(1);
  });

  it("清理失败时给出原因", async () => {
    await renderPage({
      archived: [],
      faces: {
        collectGarbage: vi.fn(async () => {
          throw new ConversationManagerRequestError("gc failed", undefined);
        }),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "清理孤儿数据" }));
    fireEvent.click(await screen.findByRole("button", { name: "开始清理" }));
    await waitFor(() => {
      expect(screen.getByText("操作失败：gc failed")).toBeTruthy();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
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
  human: {
    turns: 1,
    steps: 1,
    userInputs: 1,
    toolCalls: 1,
    inputTokens: 100,
    outputTokens: 10,
    cacheReadTokens: 0,
    reasoningTokens: 0,
    totalTokens: 110,
  },
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

describe("对话管理页面：token 用量统计", () => {
  it("第一层切到统计：拉一次数据，默认总览含子代理拆分", async () => {
    const { faces, container } = await renderPage({
      archived: [],
      faces: { loadUsage: vi.fn(async () => REPORT) },
    });

    fireEvent.click(screen.getByRole("button", { name: "统计" }));
    await waitFor(() => {
      expect(faces.loadUsage).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByRole("button", { name: "总览" })).toBeTruthy();
    expect(screen.getByText("全部会话")).toBeTruthy();
    expect(screen.getAllByText("输入（含缓存）").length).toBe(2);
    expect(screen.getByText("65")).toBeTruthy();
    expect(screen.getByText("其中子代理")).toBeTruthy();
    expect(screen.getAllByText("55").length).toBeGreaterThan(0);
    // 行内不再有「合计」项。
    expect(container.querySelector('[data-usage-cell="total"]')).toBeNull();
  });

  it("二层切维度（按模型 / 按会话），时间范围切换会带参数重新请求", async () => {
    const loadUsage = vi.fn(async () => REPORT);
    await renderPage({ archived: [], faces: { loadUsage } });
    fireEvent.click(screen.getByRole("button", { name: "统计" }));
    await screen.findByText("总览");
    expect(loadUsage).toHaveBeenCalledWith("day");

    fireEvent.click(screen.getByRole("button", { name: "按模型" }));
    expect(screen.getByText("deepseek-official / v4")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "按会话" }));
    expect(screen.getByText("会话 A")).toBeTruthy();

    // 「按天」这一栏已被时间范围取代。
    expect(screen.queryByRole("button", { name: "按天" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "近 7 天" }));
    await waitFor(() => {
      expect(loadUsage).toHaveBeenLastCalledWith("7d");
    });

    // 自然边界也走同一套语义键。
    fireEvent.click(screen.getByRole("button", { name: "本日" }));
    await waitFor(() => {
      expect(loadUsage).toHaveBeenLastCalledWith("day");
    });
    fireEvent.click(screen.getByRole("button", { name: "本周" }));
    await waitFor(() => {
      expect(loadUsage).toHaveBeenLastCalledWith("week");
    });
  });

  it("输入在显示上含缓存读取（单项原始值随之）", async () => {
    const withCache = {
      ...REPORT,
      totals: { ...TOTALS_165, cacheReadTokens: 1_000 },
      subagent: { ...TOTALS_55, cacheReadTokens: 0 },
    };
    const { container } = await renderPage({
      archived: [],
      faces: { loadUsage: vi.fn(async () => withCache) },
    });
    fireEvent.click(screen.getByRole("button", { name: "统计" }));
    await screen.findByText("总览");

    // 输入含缓存：100 + 1000 = 1100（原始值挂在 data-usage-value 上）。
    const metric = (key: string): string | null | undefined =>
      container.querySelector(`[data-usage-cell="${key}"]`)?.getAttribute("data-usage-value");
    expect(metric("input")).toBe("1100");
    expect(screen.getByText("1.1K")).toBeTruthy();
    // 缓存输入是它的子项；命中率是缓存输入占总输入（含缓存）的比例。
    expect(metric("cacheInput")).toBe("1000");
    expect(Number(metric("cacheRate"))).toBeCloseTo(90.9, 1);
    expect(screen.getByText("90.9%")).toBeTruthy();
  });

  it("统计行：label 在上，单项内部上下、单项之间横向，且没有 total 项", async () => {});

  it("数据位都带 data-* 标注，便于按标注沟通定位", async () => {
    const { container } = await renderPage({
      archived: [C.id],
      faces: { loadUsage: vi.fn(async () => REPORT) },
    });

    // 会话视图：视图、行状态、按钮、分页带标注（行标题/明细页面上可见，不重复标注）。
    expect(container.querySelector('[data-view="sessions"]')).toBeTruthy();
    const rows = [...container.querySelectorAll("[data-session-id]")] as HTMLElement[];
    // 列表按最近活动降序：首行是未归档的会话 A；归档/子代理标记在行自身的 data-* 上。
    expect(rows[0]?.dataset["sessionId"]).toBe("s1");
    expect(rows[0]?.dataset["archived"]).toBe("false");
    expect(rows[0]?.dataset["subagent"]).toBe("false");
    expect(rows[0]?.querySelector('[data-action="remove"]')).toBeTruthy();
    expect(rows.find((el) => el.dataset["archived"] === "true")?.dataset["sessionId"]).toBe("s3");
    expect(container.querySelector("[data-pagination]")?.getAttribute("data-page-current")).toBe(
      "1",
    );
    expect(container.querySelector('[data-filter="search"]')).toBeTruthy();

    // 统计视图：格子、行、维度也带标注。
    fireEvent.click(screen.getByRole("button", { name: "统计" }));
    await screen.findByText("总览");
    expect(
      container.querySelector('[data-usage-cell="output"]')?.getAttribute("data-usage-value"),
    ).toBe("65");
    expect(container.querySelector('[data-usage-key="subagent"]')).toBeTruthy();
    expect(
      container.querySelector('[data-usage-cell="toolCalls"]')?.getAttribute("data-usage-value"),
    ).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: "按模型" }));
    expect(container.querySelector('[data-usage-key="deepseek-official / v4"]')).toBeTruthy();
    expect(container.querySelector('[data-tab="models"]')).toBeTruthy();
    expect(container.querySelector("[data-usage-range]")?.getAttribute("data-usage-range")).toBe(
      "day",
    );
  });

  it("活动计数替换「事件」：总览与会话行显示轮次 / 步骤 / 用户输入 / 工具调用", async () => {
    const { container } = await renderPage({
      archived: [],
      faces: { loadUsage: vi.fn(async () => REPORT) },
    });
    fireEvent.click(screen.getByRole("button", { name: "统计" }));
    await screen.findByText("总览");

    const cell = (key: string): string | null | undefined =>
      container.querySelector(`[data-usage-cell="${key}"]`)?.getAttribute("data-usage-value");
    expect(cell("turns")).toBe("2");
    expect(cell("steps")).toBe("2");
    expect(cell("userInputs")).toBe("2");
    expect(cell("toolCalls")).toBe("1");
    // 「事件」这一项已经没有了。
    expect(container.querySelector('[data-usage-cell="events"]')).toBeNull();
    expect(screen.getAllByText("轮次").length).toBeGreaterThan(0);
    expect(screen.getAllByText("工具调用").length).toBe(2);

    fireEvent.click(screen.getByRole("button", { name: "按会话" }));
    expect(cell("turns")).toBe("2");
  });

  it("按模型的行不显示活动计数（事件没有模型归属）", async () => {
    const { container } = await renderPage({
      archived: [],
      faces: { loadUsage: vi.fn(async () => REPORT) },
    });
    fireEvent.click(screen.getByRole("button", { name: "统计" }));
    await screen.findByText("总览");

    fireEvent.click(screen.getByRole("button", { name: "按模型" }));
    expect(container.querySelector('[data-usage-key="deepseek-official / v4"]')).toBeTruthy();
    expect(container.querySelector('[data-usage-cell="turns"]')).toBeNull();
    expect(container.querySelector('[data-usage-cell="output"]')).toBeTruthy();
  });

  it("按模型把子代理的桶合进同一行（人类与子代理不拆）", async () => {
    const { container } = await renderPage({
      archived: [],
      faces: { loadUsage: vi.fn(async () => REPORT) },
    });
    fireEvent.click(screen.getByRole("button", { name: "统计" }));
    await screen.findByText("总览");

    fireEvent.click(screen.getByRole("button", { name: "按模型" }));
    // 人类 65 + 子代理 55 折进同一个 provider / model 行。
    expect(container.querySelectorAll('[data-usage-key="deepseek-official / v4"]').length).toBe(1);
    expect(
      container.querySelector('[data-usage-cell="output"]')?.getAttribute("data-usage-value"),
    ).toBe("120");
  });

  it("按会话标出子代理会话，并可只看子代理", async () => {
    const { container } = await renderPage({
      archived: [],
      faces: { loadUsage: vi.fn(async () => REPORT) },
    });
    fireEvent.click(screen.getByRole("button", { name: "统计" }));
    await screen.findByText("总览");

    // 过滤开关只在按会话维度出现（总览 / 按模型没有这个维度）。
    expect(screen.queryByRole("button", { name: "只看子代理会话" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "按会话" }));

    const humanRow = container.querySelector('[data-usage-key="s1"]');
    const subagentRow = container.querySelector('[data-usage-key="s4"]');
    expect(humanRow?.getAttribute("data-subagent")).toBe("false");
    expect(subagentRow?.getAttribute("data-subagent")).toBe("true");
    // 子代理行的「子代理」标记：标签精确匹配，不吃行标题里的同名文字。
    expect(within(subagentRow as HTMLElement).getByText("子代理")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "只看子代理会话" }));
    expect(container.querySelector('[data-usage-key="s1"]')).toBeNull();
    expect(container.querySelector('[data-usage-key="s4"]')).toBeTruthy();

    // 维度切走再切回：开关与筛选都保留（只是该维度自己的过滤）。
    fireEvent.click(screen.getByRole("button", { name: "总览" }));
    expect(screen.queryByRole("button", { name: "只看子代理会话" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "按会话" }));
    expect(container.querySelector('[data-usage-key="s1"]')).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: "统计" }));
    await waitFor(() => {
      expect(screen.getByText("操作失败：boom")).toBeTruthy();
    });
  });
});

describe("对话管理页面：滚动分区", () => {
  // 上游一级页面的滚动形态（`ui-schedule/TaskManagerPage` 那套）：列自己滚，标题行 / 过滤行 / 搜索行 /
  // 列表在**同一个**滚动层里，页面根不滚。
  it("标题行、过滤行、搜索行与列表在同一个滚动层里", async () => {
    const { container } = await renderPage({ archived: [B.id, C.id] });

    const scroll = container.querySelector(`.${frameCss.pageScroll}`);
    expect(scroll).not.toBeNull();
    // 通信用的稳定标注仍在：滚动层自己能按 `[data-scroll="page"]` 找到。
    expect(scroll!.getAttribute("data-scroll")).toBe("page");
    expect(scroll!.querySelector(`.${frameCss.pageHeading}`)).not.toBeNull();
    expect(scroll!.querySelector(`.${frameCss.pageContent}`)).not.toBeNull();
    expect(scroll!.querySelector('[data-filter="search"]')).not.toBeNull();
    expect(scroll!.querySelector("li[data-session-id]")).not.toBeNull();
    expect(scroll!.querySelector("[data-pagination]")).not.toBeNull();
  });

  it("统计视图同样在这一层里（换视图不换滚动容器）", async () => {
    const { container } = await renderPage({ archived: [] });
    fireEvent.click(screen.getByRole("button", { name: "统计" }));
    await waitFor(() => {
      expect(container.querySelector("[data-usage-range]")).not.toBeNull();
    });

    const scroll = container.querySelector(`.${frameCss.pageScroll}`);
    expect(scroll).not.toBeNull();
    expect(scroll!.querySelector(`.${frameCss.pageHeading}`)).not.toBeNull();
    expect(scroll!.contains(container.querySelector("[data-usage-range]"))).toBe(true);
    expect(scroll!.contains(container.querySelector('[data-filter="search"]'))).toBe(false);
  });
});

// 页面框架与状态态：框架与上游一级页面同款（960px 居中列 + `pageHeading` 标题行 + `filterTabs` 过滤 chip 行 +
// `searchField` 搜索行），切换控件是**筛选 chip**（`role="group"` + `aria-pressed`，不再是 tab 条）；
// 读取 / 一份会话都没有 / 读列表失败这三种状态占满整个面板并居中。
// 几何（960px 上限、28px + macOS 顶栏让位、居中）住在 `ConversationManagerPage.module.css`：jsdom 没有布局，
// 这里钉住结构与类名契约，真几何在浏览器里核对。
describe("对话管理页面：框架与状态态", () => {
  it("标题行与过滤行来自页面框架那几档类名", async () => {
    const { container } = await renderPage({ archived: [C.id] });

    const heading = container.querySelector(`.${frameCss.pageHeading}`);
    expect(heading?.querySelector("h1")?.textContent).toBe(zh.title);
    expect(heading?.querySelector('[data-action="import"]')).not.toBeNull();

    const viewGroup = container.querySelector('[data-filter="view"]');
    expect(viewGroup?.getAttribute("role")).toBe("group");
    const usageChip = within(viewGroup as HTMLElement).getByRole("button", { name: "统计" });
    expect(usageChip.className).toContain(frameCss.filterTab);
    expect(usageChip.getAttribute("aria-pressed")).toBe("false");

    expect(container.querySelector(`.${frameCss.searchField}`)).not.toBeNull();
  });

  it("子代理过滤是 chip：选中带 active 类与 aria-pressed", async () => {
    const { container } = await renderPage({ archived: [C.id] });
    const chip = within(
      container.querySelector('[data-filter="subagents"]') as HTMLElement,
    ).getByRole("button", { name: "显示子代理会话" });

    expect(chip.getAttribute("aria-pressed")).toBe("false");
    expect(chip.className).not.toContain(frameCss.filterTabActive);

    fireEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(chip.className).toContain(frameCss.filterTabActive);
  });

  it("搜索行里的清空按钮只在有查询时出现，点了清空并还原列表", async () => {
    await renderPage({ archived: [B.id, C.id] });
    expect(screen.queryByRole("button", { name: "清空搜索" })).toBeNull();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "B" } });
    await waitFor(() => {
      expect(rowTexts()).toHaveLength(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "清空搜索" }));
    await waitFor(() => {
      expect(rowTexts()).toHaveLength(3);
    });
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
  });

  it("读取中：状态占满面板并居中，此时不画标题行与搜索行", async () => {
    const { container } = await renderPage({
      archived: [B.id],
      listRows: () => new Promise(() => {}),
      skipReady: true,
    });

    const status = container.querySelector('[data-status="loading"]');
    expect(status?.className).toContain(frameCss.status);
    expect(status?.querySelector('[role="status"]')).not.toBeNull();
    expect(screen.getByText(zh.loading)).toBeTruthy();
    expect(container.querySelector(`.${frameCss.pageHeading}`)).toBeNull();
    expect(container.querySelector('[data-filter="search"]')).toBeNull();
  });

  it("一份会话都没有：同样整屏居中，不画框架", async () => {
    const { container } = await renderPage({ archived: [], sessions: [], workspaces: [] });

    const status = container.querySelector('[data-status="empty"]');
    expect(status?.className).toContain(frameCss.status);
    expect(screen.getByText(zh.empty)).toBeTruthy();
    expect(container.querySelector(`.${frameCss.pageHeading}`)).toBeNull();
  });

  it("读列表失败：整屏居中的失败态（并带 role=alert）", async () => {
    const { container } = await renderPage({
      archived: [],
      listRows: async () => {
        throw new ConversationManagerRequestError("boom", undefined);
      },
      skipReady: true,
    });

    await waitFor(() => {
      expect(container.querySelector('[data-status="failure"]')).not.toBeNull();
    });
    const status = container.querySelector('[data-status="failure"]');
    expect(status?.className).toContain(frameCss.status);
    expect(status?.querySelector('[role="alert"]')?.textContent).toContain("boom");
    expect(container.querySelector(`.${frameCss.pageHeading}`)).toBeNull();
  });

  it("搜索无结果：框架照旧在，空态落在列表位置", async () => {
    const { container } = await renderPage({ archived: [B.id, C.id] });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });
    await waitFor(() => {
      expect(rowTexts()).toHaveLength(0);
    });

    expect(container.querySelector('[data-status="empty-search"]')).not.toBeNull();
    expect(container.querySelector(`.${frameCss.pageHeading}`)).not.toBeNull();
    expect(screen.getByText(zh.emptySearch)).toBeTruthy();
  });
});
