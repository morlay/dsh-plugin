// @vitest-environment happy-dom
// 页面闭环：列表、搜索下推、分页、子代理过滤、三种整屏状态，以及动作按钮只经注入面。
// 组件 spec 直喂 props（框架座位由本文件提供替身），几何在浏览器里核对，这里钉住结构与标注。
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, test } from "@morlay/session-rdb/testing";
import { vi } from "vitest";
import { ConversationManagerPage } from "../conversation-manager-page.tsx";
import type { ConversationManagerFace } from "../conversation-manager.controller.ts";
import { ConversationManagerRequestError } from "../conversation-manager.controller.ts";
import { zh } from "../locales.ts";
import type { ConversationManagerKey } from "../locales.ts";

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
    exportFiltered: vi.fn(async () => ({ items: [] })),
    importZip: vi.fn(async () => "session-new"),
    importMany: vi.fn(async (files: readonly File[]) => ({
      items: files.map((file) => ({ ok: true, filename: file.name })),
    })),
    locateEvents: vi.fn(async () => ({
      sessionId: "s1",
      items: [],
      total: 0,
      window: { fromSeq: 0, toSeq: 0 },
    })),
    listWorkspaces: vi.fn(async () => [{ workspaceId: "w-target", title: "目标工作区" }]),
    copyToWorkspace: vi.fn(async (sessionId: string, workspaceId: string) => ({
      sessionId: "copy-of-" + sessionId,
      workspaceId,
    })),
    organizeData: vi.fn(async () => ({
      stoppedAgents: 0,
      orphanSessions: 0,
      orphanEvents: 0,
      rebuiltSessions: 0,
      vacuumed: true,
    })),
    loadUsage: vi.fn(async () => EMPTY_REPORT),
    checkConsistency: vi.fn(async () => ({
      ok: true,
      checked: { sessions: 0, events: 0, bridges: 0, usageRows: 0, countRows: 0 },
      issues: [],
    })),
    repairSession: vi.fn(async () => ({
      sessionId: "session-a",
      action: "rewrite",
      keptEvents: 0,
      droppedEvents: 0,
    })),
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
  test("按最近活动降序列出会话，并把工作区摊平", async () => {
    await renderPage({ archived: [B.sessionId, C.sessionId] });
    expect(rowTexts()).toHaveLength(3);
    expect(rowTexts()[0]).toContain("会话 A");
    expect(rowTexts()[0]).toContain("工作区一");
    expect(rowTexts()[2]).toContain("未分组");
  });

  test("搜索下推到宿主，命中后只剩匹配的行", async () => {
    const bench = await renderPage({ archived: [B.sessionId, C.sessionId] });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "B" } });
    await waitFor(() => {
      expect(rowTexts()).toHaveLength(1);
    });
    expect(bench.faces.listRows).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: "B", page: 1 }),
    );
  });

  test("搜索无结果时给出空搜索文案，框架仍在", async () => {
    const bench = await renderPage({ archived: [B.sessionId, C.sessionId] });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });
    await waitFor(() => {
      expect(rowTexts()).toHaveLength(0);
    });
    expect(bench.container.querySelector('[data-status="empty-search"]')).not.toBeNull();
    expect(screen.getByText(zh.emptySearch)).toBeTruthy();
  });

  test("刷新失败时保留旧行、错误可见且可重试", async () => {
    let fail = false;
    const listRows = async (query: Record<string, unknown> = {}) => {
      if (fail) throw new ConversationManagerRequestError("boom", "SESSION_QUERY_FAILED");
      return await backendRows([A, B, C], [B.sessionId, C.sessionId])(query);
    };
    const bench = await renderPage({ archived: [], listRows });
    expect(rowTexts()).toHaveLength(3);

    fail = true;
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "B" } });
    await waitFor(() => {
      expect(bench.container.querySelector('[data-failure="reload"]')).not.toBeNull();
    });
    // 失败不能吞掉已经读到的行：用户要看到的是「旧数据 + 失败提示」。
    expect(rowTexts()).toHaveLength(3);

    fail = false;
    const banner = bench.container.querySelector('[data-failure="reload"]') as HTMLElement;
    fireEvent.click(within(banner).getByRole("button", { name: zh.retry }));
    await waitFor(() => {
      expect(bench.container.querySelector('[data-failure="reload"]')).toBeNull();
    });
  });

  test("慢的旧响应不覆盖新响应：只有最后发出的那次落到界面", async () => {
    const pending: Array<(value: unknown) => void> = [];
    const listRows = () =>
      new Promise((resolve) => {
        pending.push(resolve);
      });
    const pageOf = (rows: readonly Row[]) => ({
      items: rows.map((row) => ({
        sessionId: row.sessionId,
        title: row.title,
        origin: row.origin ?? null,
        cwd: null,
        createdAt: 0,
        updatedAt: row.updatedAt ?? 0,
        archived: false,
        workspace: null,
      })),
      total: rows.length,
      page: 1,
      pageSize: 20,
    });

    const bench = await renderPage({ archived: [], listRows, skipReady: true });
    await waitFor(() => {
      expect(bench.faces.listRows).toHaveBeenCalledTimes(1);
    });
    pending[0]?.(pageOf([A, B, C]));
    await waitFor(() => {
      expect(rowTexts()).toHaveLength(3);
    });

    // 两次搜索各发一次请求，都先挂住（防抖窗口 250ms）。
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "B" } });
    await waitFor(
      () => {
        expect(bench.faces.listRows).toHaveBeenCalledTimes(2);
      },
      { timeout: 3_000 },
    );
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "C" } });
    await waitFor(
      () => {
        expect(bench.faces.listRows).toHaveBeenCalledTimes(3);
      },
      { timeout: 3_000 },
    );

    // 后发先至：第三次（命中 C）先回，第二次（命中 B）后回——界面必须停在 C 上。
    pending[2]?.(pageOf([C]));
    pending[1]?.(pageOf([B]));
    await waitFor(() => {
      expect(rowTexts()).toHaveLength(1);
    });
    expect(rowTexts()[0]).toContain("会话 C");
  });

  test("一份会话都没有时保留框架与导入入口（空态不能吞掉自救动作）", async () => {
    const bench = await renderPage({ archived: [], sessions: [] });
    expect(bench.container.querySelector('[data-status="empty"]')).not.toBeNull();
    expect(screen.getByText(zh.empty)).toBeTruthy();
    // 空库时唯一能自救的动作就在标题行与空态里：标题必须还在，导入入口必须可点。
    expect(bench.container.querySelector("h1")).not.toBeNull();
    expect(screen.getAllByRole("button", { name: zh.import }).length).toBeGreaterThan(0);
  });

  test("默认不显示子代理会话，勾选后显示并带标记", async () => {
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

  test("每页 20 条，翻页生效，搜索回到第一页", async () => {
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

  test("末页被删空时页码回落到最后一页，不停在空页上", async () => {
    const many: Row[] = Array.from({ length: 25 }, (_unused, index) => ({
      sessionId: "s" + String(index),
      title: "会话 " + String(index),
    }));
    const pageOf = (total: number, items: readonly Row[]) => ({
      items: items.map((row) => ({
        sessionId: row.sessionId,
        title: row.title,
        origin: null,
        cwd: null,
        createdAt: 0,
        updatedAt: 0,
        archived: false,
        workspace: null,
      })),
      total,
      page: 1,
      pageSize: 20,
    });
    let calls = 0;
    const listRows = vi.fn(async (query: Record<string, unknown> = {}) => {
      calls += 1;
      if (calls === 1) return pageOf(25, many.slice(0, 20));
      // 第 2 页的请求回来时那一页已被删空，总数退到 20。
      if (query["page"] === 2) return { items: [], total: 20, page: 2, pageSize: 20 };
      return pageOf(20, many.slice(0, 20));
    });
    const bench = await renderPage({ archived: [], sessions: many, listRows });
    expect(screen.getByText("第 1 / 2 页")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: zh["page.next"] }));
    await waitFor(() => {
      expect(
        bench.container.querySelector("[data-pagination]")?.getAttribute("data-page-current"),
      ).toBe("1");
    });
    expect(
      bench.container.querySelector("[data-pagination]")?.getAttribute("data-page-total"),
    ).toBe("1");
    expect(rowTexts()).toHaveLength(20);
  });

  test("翻页后列表变化有播报", async () => {
    const many: Row[] = Array.from({ length: 25 }, (_unused, index) => ({
      sessionId: "s" + String(index),
      title: "会话 " + String(index),
    }));
    const bench = await renderPage({ archived: [], sessions: many });
    const announced = (): string =>
      bench.container.querySelector('[data-announce="rows"]')?.textContent ?? "";
    expect(announced()).toContain("第 1 / 2 页");

    fireEvent.click(screen.getByRole("button", { name: zh["page.next"] }));
    await waitFor(() => {
      expect(announced()).toContain("第 2 / 2 页，共 25 条会话。");
    });
  });

  test("读列表失败时整屏失败态并带 role=alert", async () => {
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
  test("归档与取消归档互斥，删除只对已归档可用", async () => {
    const bench = await renderPage({ archived: [C.sessionId] });
    expect(screen.getAllByText(zh.archived)).toHaveLength(1);

    // 未归档的行不能删除，但按钮仍然可聚焦（点了给理由，见下一条用例）。
    const ariaDisabled = (name: string): string | null =>
      screen.getByRole("button", { name }).getAttribute("aria-disabled");

    expect(screen.queryByRole("button", { name: "取消归档 会话 A" })).toBeNull();
    expect(ariaDisabled("删除 会话 A")).toBe("true");
    expect(ariaDisabled("删除 会话 C")).toBeNull();
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

  test("未归档会话的删除按钮可聚焦，点击给出理由而不是无理由禁用", async () => {
    const bench = await renderPage({ archived: [C.sessionId] });
    const removeA = screen.getByRole("button", { name: "删除 会话 A" });
    expect((removeA as HTMLButtonElement).disabled).toBe(false);
    expect(removeA.getAttribute("aria-disabled")).toBe("true");

    removeA.focus();
    expect(document.activeElement).toBe(removeA);

    fireEvent.click(removeA);
    await waitFor(() => {
      expect(screen.getByText(zh["failure.notArchived"])).toBeTruthy();
    });
    expect(bench.faces.remove).not.toHaveBeenCalled();
  });

  test("删除确认按钮用危险语义，在途不可重复触发", async () => {
    const gate = Promise.withResolvers<void>();
    const bench = await renderPage({
      archived: [C.sessionId],
      faces: { remove: vi.fn(() => gate.promise) },
    });
    fireEvent.click(screen.getByRole("button", { name: "删除 会话 C" }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: zh.confirmAccept });
    expect(confirm.getAttribute("data-tone")).toBe("danger");

    fireEvent.click(confirm);
    await waitFor(() => {
      expect((confirm as HTMLButtonElement).disabled).toBe(true);
    });
    expect(confirm.getAttribute("aria-busy")).toBe("true");

    fireEvent.click(confirm);
    gate.resolve();
    await waitFor(() => {
      expect(bench.faces.remove).toHaveBeenCalledTimes(1);
    });
  });

  test("删除成功后焦点落在列表标题，不回给已重拉的行按钮", async () => {
    await renderPage({ archived: [C.sessionId] });
    fireEvent.click(screen.getByRole("button", { name: "删除 会话 C" }));
    fireEvent.click(await screen.findByRole("button", { name: zh.confirmAccept }));
    await waitFor(() => {
      expect(document.activeElement?.tagName).toBe("H1");
    });
    expect((document.activeElement as HTMLElement).textContent).toBe(zh.title);
  });

  test("删除先弹确认，未确认前不请求", async () => {
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

  test("确认弹窗可以取消", async () => {
    const bench = await renderPage({ archived: [C.sessionId] });
    fireEvent.click(screen.getByRole("button", { name: "删除 会话 C" }));
    fireEvent.click(await screen.findByRole("button", { name: zh.confirmCancel }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(bench.faces.remove).not.toHaveBeenCalled();
  });

  test("删除被宿主拒绝时给出可读原因", async () => {
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

  test("导入 zip 为新会话并提示结果", async () => {
    const bench = await renderPage({ archived: [] });
    const input = bench.container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("missing file input");
    const file = new File([new Uint8Array([1])], "session.zip", { type: "application/zip" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      // 导入面多了可选的阶段回调：文件不变，第二个参数带上阶段回调。
      expect(bench.faces.importZip).toHaveBeenCalledWith(
        file,
        expect.objectContaining({ onStage: expect.any(Function) }),
      );
    });
    await waitFor(() => {
      expect(screen.getByText(zh.imported)).toBeTruthy();
    });
  });

  test("导入在途给阶段提示与不可取消说明", async () => {
    const gate = Promise.withResolvers<string>();
    let pushStage: ((stage: "reading" | "committing") => void) | undefined;
    const bench = await renderPage({
      archived: [],
      faces: {
        importZip: vi.fn(
          (_file: File, options?: { onStage?: (stage: "reading" | "committing") => void }) => {
            pushStage = options?.onStage;
            return gate.promise;
          },
        ),
      },
    });
    const input = bench.container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("missing file input");
    const file = new File([new Uint8Array([1])], "session.zip", { type: "application/zip" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText(zh["import.reading"])).toBeTruthy();
    });
    act(() => {
      pushStage?.("committing");
    });
    await waitFor(() => {
      expect(screen.getByText(zh["import.committing"])).toBeTruthy();
    });
    // 不可取消写在提示里：长任务没有取消面。
    expect(screen.getByText(zh["import.committing"]).textContent).toContain("不能取消");
    // 在途时导入入口不可重复触发。
    expect((screen.getByRole("button", { name: zh.importing }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    gate.resolve("session-new");
    await waitFor(() => {
      expect(screen.queryByText(zh["import.committing"])).toBeNull();
    });
  });

  test("覆盖导入先确认：确认前不发请求，确认后带目标会话", async () => {
    const bench = await renderPage({ archived: [C.sessionId] });
    fireEvent.click(screen.getByRole("button", { name: "覆盖导入 会话 C" }));
    const input = bench.container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("missing file input");
    const file = new File([new Uint8Array([1])], "session.zip", { type: "application/zip" });
    fireEvent.change(input, { target: { files: [file] } });

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain(zh.importReplaceTitle);
    expect(bench.faces.importZip).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: zh.importReplaceAccept }));
    await waitFor(() => {
      expect(bench.faces.importZip).toHaveBeenCalledWith(
        file,
        expect.objectContaining({ sessionId: "s3" }),
      );
    });
    await waitFor(() => {
      expect(screen.getByText(zh.importReplaced)).toBeTruthy();
    });
  });

  test("覆盖导入的确认按钮用危险语义，在途不可再触发", async () => {
    const gate = Promise.withResolvers<string>();
    const bench = await renderPage({
      archived: [C.sessionId],
      faces: { importZip: vi.fn(() => gate.promise) },
    });
    fireEvent.click(screen.getByRole("button", { name: "覆盖导入 会话 C" }));
    const input = bench.container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("missing file input");
    const file = new File([new Uint8Array([1])], "session.zip", { type: "application/zip" });
    fireEvent.change(input, { target: { files: [file] } });

    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: zh.importReplaceAccept });
    expect(confirm.getAttribute("data-tone")).toBe("danger");
    fireEvent.click(confirm);

    // 确认后弹窗收掉，行内的覆盖入口在导入结束前保持禁用：同一份文件不会发两次。
    await waitFor(() => {
      expect(
        (screen.getByRole("button", { name: "覆盖导入 会话 C" }) as HTMLButtonElement).disabled,
      ).toBe(true);
    });
    fireEvent.click(screen.getByRole("button", { name: "覆盖导入 会话 C" }));
    expect(bench.faces.importZip).toHaveBeenCalledTimes(1);

    gate.resolve("s3");
    await waitFor(() => {
      expect(screen.getByText(zh.importReplaced)).toBeTruthy();
    });
  });

  test("成功提示落在 role=status，失败原因落在 role=alert", async () => {
    const bench = await renderPage({
      archived: [C.sessionId],
      faces: {
        remove: vi.fn(async () => {
          throw new ConversationManagerRequestError("not archived", "SESSION_NOT_ARCHIVED");
        }),
      },
    });
    const input = bench.container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("missing file input");
    const file = new File([new Uint8Array([1])], "session.zip", { type: "application/zip" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByText(zh.imported)).toBeTruthy();
    });
    expect(bench.container.querySelector('[data-notice="result"]')?.getAttribute("role")).toBe(
      "status",
    );

    fireEvent.click(screen.getByRole("button", { name: "删除 会话 C" }));
    fireEvent.click(await screen.findByRole("button", { name: zh.confirmAccept }));
    await waitFor(() => {
      expect(screen.getByText(zh["failure.notArchived"])).toBeTruthy();
    });
    expect(bench.container.querySelector('[data-failure="result"]')?.getAttribute("role")).toBe(
      "alert",
    );
  });

  test("行内导出调用注入面", async () => {
    const bench = await renderPage({ archived: [C.sessionId] });
    fireEvent.click(screen.getByRole("button", { name: "导出 会话 C" }));
    await waitFor(() => {
      expect(bench.faces.exportZip).toHaveBeenCalledWith("s3");
    });
  });

  test("批量归档先确认：确认前不发请求，确认后逐条调归档动作并把失败聚合成一条提示", async () => {
    const bench = await renderPage({ archived: [] });
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 会话 A" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 会话 B" }));
    fireEvent.click(screen.getByRole("button", { name: "归档 2 条会话" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain(zh["bulkArchive.confirmTitle"]);
    expect(bench.faces.archive).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: zh["bulkArchive.confirmAccept"] }));

    await waitFor(() => {
      expect(bench.faces.archive).toHaveBeenCalledTimes(2);
    });
    expect(bench.faces.archive).toHaveBeenCalledWith("s1");
    expect(bench.faces.archive).toHaveBeenCalledWith("s2");
    await waitFor(() => {
      expect(screen.getByText("已归档 2 条会话，0 条失败。")).toBeTruthy();
    });
  });

  test("批量归档逐条结算：失败那条的会话与原因进同一条提示", async () => {
    const bench = await renderPage({
      archived: [],
      faces: {
        archive: vi.fn(async (sessionId: string) => {
          if (sessionId === "s2") {
            throw new ConversationManagerRequestError(
              'session "s2" not found',
              "SESSION_NOT_FOUND",
            );
          }
        }),
      },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 会话 A" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 会话 B" }));
    fireEvent.click(screen.getByRole("button", { name: "归档 2 条会话" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: zh["bulkArchive.confirmAccept"] }));

    await waitFor(() => {
      expect(bench.container.querySelector('[data-notice="result"]')).not.toBeNull();
    });
    const notice = bench.container.querySelector('[data-notice="result"]')?.textContent ?? "";
    expect(notice).toContain("已归档 1 条会话，1 条失败。");
    expect(notice).toContain("s2");
    expect(notice).toContain(zh["failure.missing"]);
  });

  test("多选 zip 走一次批量导入，单个文件仍走单条导入", async () => {
    const bench = await renderPage({ archived: [] });
    const input = bench.container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("missing file input");
    const files = [
      new File([new Uint8Array([1])], "a.zip", { type: "application/zip" }),
      new File([new Uint8Array([2])], "b.zip", { type: "application/zip" }),
    ];
    fireEvent.change(input, { target: { files } });
    await waitFor(() => {
      expect(bench.faces.importMany).toHaveBeenCalledWith(files);
    });
    expect(bench.faces.importZip).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText("已导入 2 个会话，0 个失败。")).toBeTruthy();
    });

    // 单个文件：还是单条导入那条路（阶段回调与「已导入为新会话」文案不变）。
    fireEvent.change(input, { target: { files: [files[0]] } });
    await waitFor(() => {
      expect(bench.faces.importZip).toHaveBeenCalledTimes(1);
    });
    expect(bench.faces.importMany).toHaveBeenCalledTimes(1);
  });

  test("定位弹窗把时间两栏换成毫秒下推，命中列表只读", async () => {
    const bench = await renderPage({
      archived: [],
      faces: {
        locateEvents: vi.fn(async () => ({
          sessionId: "s1",
          items: [
            { seq: 2, type: "user/message", role: "user", name: null, time: 1, snippet: "深水区" },
          ],
          total: 1,
          window: { fromSeq: 0, toSeq: 5 },
        })),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "在 会话 A 里定位事件" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(zh["locate.fromTime"]), {
      target: { value: "2026-03-10T00:00" },
    });
    fireEvent.change(within(dialog).getByLabelText(zh["locate.name"]), {
      target: { value: "read" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: zh["locate.run"] }));

    await waitFor(() => {
      expect(bench.faces.locateEvents).toHaveBeenCalledWith(
        "s1",
        expect.objectContaining({ name: "read", fromTime: new Date("2026-03-10T00:00").getTime() }),
      );
    });
    const results = dialog.querySelector('[data-locate="results"]');
    expect(results?.getAttribute("data-locate-window")).toBe("0-5");
    expect(dialog.querySelector('[data-locate-hit="2"]')?.textContent).toContain("深水区");
    expect(results?.querySelector("button")).toBeNull();
  });

  test("会话在别处运行时给可读文案与建议（不是原始错误）", async () => {
    const bench = await renderPage({
      archived: [C.sessionId],
      faces: {
        exportZip: vi.fn(async () => {
          throw new ConversationManagerRequestError(
            'session "s3" was appended by another writer at seq 6',
            "SESSION_CONCURRENT_WRITER",
          );
        }),
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "导出 会话 C" }));

    await waitFor(() => {
      expect(screen.getByText(zh["failure.concurrent"])).toBeTruthy();
    });
    // 用户看到的是「该会话在别处运行 + 建议」，不是库里的位点细节。
    const failure = bench.container.querySelector('[data-failure="result"]') as HTMLElement;
    expect(failure.textContent).not.toContain("another writer");
  });

  test("按筛选结果批量导出：当前的搜索与归档筛选原样交给动作面", async () => {
    const bench = await renderPage({ archived: [B.sessionId] });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "会话" } });
    const group = bench.container.querySelector('[data-filter="archived"]') as HTMLElement;
    fireEvent.click(within(group).getByRole("button", { name: zh["filter.archived.only"] }));
    // 先让列表按新筛选重拉一次，再导出：动作面拿到的必须与列表同一组条件。
    await waitFor(() => {
      expect(bench.faces.listRows).toHaveBeenCalledWith(
        expect.objectContaining({ query: "会话", archived: "only" }),
      );
    });

    fireEvent.click(within(bench.container).getByRole("button", { name: zh.exportFiltered }));

    await waitFor(() => {
      expect(bench.faces.exportFiltered).toHaveBeenCalledWith(
        expect.objectContaining({ query: "会话", archived: "only" }),
      );
    });
  });

  test("整理数据先确认，执行期间阻塞界面且没有关闭按钮", async () => {
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
  test("切到统计拉一次数据，默认总览含子代理拆分", async () => {
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

  test("二层切维度，时间范围切换会带参数重新请求", async () => {
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

  test("输入在显示上含缓存读取，命中率是缓存占总输入的比例", async () => {
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

  test("按模型把子代理的桶合进同一行", async () => {
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

  test("按模型的行不显示活动计数（事件没有模型归属）", async () => {
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

  test("按会话标出子代理，并可只看子代理", async () => {
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

  test("统计失败时给出原因", async () => {
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

  test("统计失败给重试入口，点了重拉当前范围", async () => {
    let fail = true;
    const loadUsage = vi.fn(async () => {
      if (fail) throw new ConversationManagerRequestError("boom", undefined);
      return REPORT;
    });
    await renderPage({ archived: [], faces: { loadUsage } });
    fireEvent.click(screen.getByRole("button", { name: zh["view.usage"] }));

    const retry = await screen.findByRole("button", { name: zh.retry });
    fail = false;
    fireEvent.click(retry);
    await waitFor(() => {
      expect(loadUsage).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getByText(zh["usage.all"])).toBeTruthy();
    });
  });
});

describe("对话管理页：框架与状态态", () => {
  test("标题行、过滤行、搜索行与列表在同一个滚动层里", async () => {
    const bench = await renderPage({ archived: [B.sessionId] });
    const scroll = bench.container.querySelector('[data-scroll="page"]');
    expect(scroll).not.toBeNull();
    expect(scroll!.querySelector("h1")?.textContent).toBe(zh.title);
    expect(scroll!.querySelector('[data-action="import"]')).not.toBeNull();
    expect(scroll!.querySelector('[data-filter="search"]')).not.toBeNull();
    expect(scroll!.querySelector("[data-session-id]")).not.toBeNull();
    expect(scroll!.querySelector("[data-pagination]")).not.toBeNull();
  });

  test("过滤 chip 用 aria-pressed 说选中", async () => {
    const bench = await renderPage({ archived: [C.sessionId] });
    const group = bench.container.querySelector('[data-filter="subagents"]');
    expect(group?.getAttribute("role")).toBe("group");
    const chip = within(group as HTMLElement).getByRole("button", { name: zh.showSubagents });
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
  });

  test("清空按钮只在有查询时出现，点了清空并还原列表", async () => {
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

  test("分页条是带 aria-label 的导航", async () => {
    const bench = await renderPage({ archived: [C.sessionId] });
    const nav = screen.getByRole("navigation", { name: zh["page.nav"] });
    expect(nav).toBe(bench.container.querySelector("[data-pagination]"));
  });

  test("读取中：状态占满面板并居中，此时不画标题行与搜索行", async () => {
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
