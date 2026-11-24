// @vitest-environment happy-dom
// L3：真装配（宿主 wire + 真库 + mock 模型目录）+ 真端点客户端 + 真页面。
// 只替换模型的输出；页面动作走真 remote 到真库，断言落在「库里的行 / 页面上的行」。
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test } from "@morlay/session-rdb/testing";
import { onTestFinished, vi } from "vitest";
import { zh } from "../locales.ts";
import {
  archiveSessionsInDb,
  corruptSessionEvent,
  dropSessionCounts,
  seedTitledSession,
  startManagerFlow,
  type ManagerFlow,
} from "../../../__tests__/support/manager-flow.ts";
import { renderManagerPage } from "../../../__tests__/support/manager-render.tsx";

// 浏览器下载面：happy-dom 没有对象 URL，把每次下载（文件名与 zip 字节）记下来。
function captureDownloads(): { blobs: Blob[]; filenames: string[] } {
  const blobs: Blob[] = [];
  const filenames: string[] = [];
  const target = URL as unknown as { createObjectURL?: unknown; revokeObjectURL?: unknown };
  target.createObjectURL = (blob: Blob) => {
    blobs.push(blob);
    return "blob:mock-" + String(blobs.length);
  };
  target.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    filenames.push(this.download);
  });
  return { blobs, filenames };
}

async function start(): Promise<ManagerFlow> {
  const flow = await startManagerFlow();
  onTestFinished(() => flow.dispose());
  return flow;
}

const renderPage = renderManagerPage;

describe("L3 对话管理页：多选批量删除", () => {
  test("勾选两行后一次删除，两条都从库里消失、列表重拉为空", async () => {
    const flow = await start();
    await seedTitledSession(flow.host, "bulk-a", "甲会话");
    await seedTitledSession(flow.host, "bulk-b", "乙会话");
    await archiveSessionsInDb(flow.host, ["bulk-a", "bulk-b"]);
    const container = renderPage(flow);

    await screen.findByText("甲会话");
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 甲会话" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 乙会话" }));
    fireEvent.click(within(container).getByRole("button", { name: /批量删除/ }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: zh["bulk.confirmAccept"] }));

    await waitFor(() => {
      expect(screen.queryByText("甲会话")).toBeNull();
    });
    expect(screen.queryByText("乙会话")).toBeNull();
    expect(await flow.host.headerOf("bulk-a")).toBeUndefined();
    expect(await flow.host.headerOf("bulk-b")).toBeUndefined();
    // 逐条结算的聚合文案：两条都删掉，没有失败项。
    await waitFor(() => {
      expect(container.querySelector('[data-notice="result"]')?.textContent).toContain(
        "已删除 2 条会话，0 条未删除。",
      );
    });
  });
});

describe("L3 对话管理页：批量删除的逐条结算", () => {
  test("一条已归档一条未归档：删掉能删的，提示里带出未删那条的会话与原因", async () => {
    const flow = await start();
    await seedTitledSession(flow.host, "mix-archived", "能删的会话");
    await seedTitledSession(flow.host, "mix-unarchived", "不能删的会话");
    await archiveSessionsInDb(flow.host, ["mix-archived"]);
    const container = renderPage(flow);

    await screen.findByText("能删的会话");
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 能删的会话" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 不能删的会话" }));
    fireEvent.click(within(container).getByRole("button", { name: /批量删除/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: zh["bulk.confirmAccept"] }));

    // 聚合文案：删掉几条、几条未删 + 未删那条的会话与原因（宿主给的域码折成的可读文案）。
    await waitFor(() => {
      expect(container.querySelector('[data-notice="result"]')).not.toBeNull();
    });
    const notice = container.querySelector('[data-notice="result"]')?.textContent ?? "";
    expect(notice).toContain("已删除 1 条会话，1 条未删除。");
    expect(notice).toContain("mix-unarchived");
    expect(notice).toContain(zh["failure.notArchived"]);
    // 库里的结果：能删的没了，不能删的还在。
    expect(await flow.host.headerOf("mix-archived")).toBeUndefined();
    expect(await flow.host.headerOf("mix-unarchived")).toBeDefined();
  });
});

describe("L3 对话管理页：筛选 chip", () => {
  test("点「已归档」只剩归档行，点「全部」恢复", async () => {
    const flow = await start();
    await seedTitledSession(flow.host, "archived-one", "归档过的会话");
    await seedTitledSession(flow.host, "kept-one", "没归档的会话");
    await archiveSessionsInDb(flow.host, ["archived-one"]);
    const container = renderPage(flow);

    await screen.findByText("归档过的会话");
    const group = container.querySelector('[data-filter="archived"]') as HTMLElement;
    fireEvent.click(within(group).getByRole("button", { name: zh["filter.archived.only"] }));

    await waitFor(() => {
      expect(screen.queryByText("没归档的会话")).toBeNull();
    });
    expect(screen.getByText("归档过的会话")).toBeTruthy();

    fireEvent.click(within(group).getByRole("button", { name: zh["filter.archived.all"] }));
    await waitFor(() => {
      expect(screen.getByText("没归档的会话")).toBeTruthy();
    });
  });
});

describe("L3 对话管理页：搜索两段式", () => {
  test("前缀搜不到时自动退全文，页面标出走的是全文", async () => {
    const flow = await start();
    await seedTitledSession(flow.host, "deep-water", "深水区报告");
    const container = renderPage(flow);
    await screen.findByText("深水区报告");

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "水区" } });

    await waitFor(() => {
      expect(screen.getByText("深水区报告")).toBeTruthy();
    });
    await waitFor(() => {
      expect(container.querySelector('[data-search-stage="contains"]')).not.toBeNull();
    });
  });
});

describe("L3 对话管理页：按筛选结果批量导出", () => {
  test("搜索命中的会话逐个下载 zip（真库里的会话、文件名按会话）", async () => {
    const flow = await start();
    await seedTitledSession(flow.host, "export-deep", "深水区报告");
    await seedTitledSession(flow.host, "export-kept", "另一份报告");
    const downloads = captureDownloads();
    const container = renderPage(flow);

    await screen.findByText("深水区报告");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "深水" } });
    // 先等列表只剩命中那一行：导出的就是这一份筛选结果。
    await waitFor(() => {
      expect(screen.queryByText("另一份报告")).toBeNull();
    });

    fireEvent.click(within(container).getByRole("button", { name: zh.exportFiltered }));

    await waitFor(() => {
      expect(downloads.filenames).toEqual(["export-deep.zip"]);
    });
    expect(downloads.blobs).toHaveLength(1);
  });
});

describe("L3 对话管理页：跨工作区复制", () => {
  test("确认并从列表里选目标工作区后，复制出的会话挂在那个工作区上", async () => {
    const flow = await start();
    await seedTitledSession(flow.host, "copy-source", "要复制的会话");
    const container = renderPage(flow);

    await screen.findByText("要复制的会话");
    fireEvent.click(
      within(container).getByRole("button", {
        name: zh["copyNamed"].replace("{title}", "要复制的会话"),
      }),
    );

    const dialog = await screen.findByRole("dialog");
    // 目标工作区来自注入面（工作区列表的 owner 在 workspace 域，页面不直连库）。
    const options = await within(dialog).findAllByRole("option");
    expect(options.map((option) => option.textContent)).toContain(flow.targetWorkspace.title);
    fireEvent.change(within(dialog).getByRole("combobox", { name: zh["copy.workspace"] }), {
      target: { value: flow.targetWorkspace.id },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: zh["copy.confirm"] }));

    // 成员归属由 workspace 域做：attach 收到复制出来的那一条，参数是目标工作区。
    await waitFor(() => {
      expect(flow.host.workspaces.attached).toHaveLength(1);
    });
    const attached = flow.host.workspaces.attached[0];
    expect(attached?.workspaceId).toBe(flow.targetWorkspace.id);
    // 真库断言：子会话在库里、cwd 是目标目录；源会话还在（复制不是移动）。
    expect(await flow.host.headerOf(attached?.sessionId ?? "")).toMatchObject({
      cwd: flow.targetWorkspace.path,
      parentSession: "copy-source",
    });
    expect(await flow.host.headerOf("copy-source")).toBeDefined();
    expect(
      await screen.findByText(zh["copy.done"].replace("{workspace}", flow.targetWorkspace.title)),
    ).toBeTruthy();
  });
});

describe("L3 对话管理页：体检与修复", () => {
  test("体检把不一致项列在页面上（真库里的漂移，页面可见）", async () => {
    const flow = await start();
    await seedTitledSession(flow.host, "drifted", "账对不上的会话");
    // 一处真实的漂移：计数行的旁路累加漏了，体检要能读出来。
    await dropSessionCounts(flow.host, "drifted");
    const container = renderPage(flow);

    await screen.findByText("账对不上的会话");
    fireEvent.click(within(container).getByRole("button", { name: zh["consistency.button"] }));

    await waitFor(() => {
      expect(container.querySelector('[data-consistency="issues"]')).not.toBeNull();
    });
    const issue = container.querySelector('[data-issue="session-counts-missing"]');
    expect(issue).not.toBeNull();
    expect(issue?.textContent).toContain("drifted");
    expect(issue?.textContent).toContain("f_turns");
  });

  test("行上的修复入口把读不出来的会话修好（真库、修完可读）", async () => {
    const flow = await start();
    await seedTitledSession(flow.host, "broken", "读不出来的会话");
    // 已提交区里的一行坏掉：这份会话从库里读不出来，但行还在列表上。
    await corruptSessionEvent(flow.host, "broken", 2);
    await expect(flow.host.eventsOf("broken")).rejects.toThrow(/corrupt session log/);
    const container = renderPage(flow);

    await screen.findByText("读不出来的会话");
    fireEvent.click(
      within(container).getByRole("button", {
        name: zh["repairNamed"].replace("{title}", "读不出来的会话"),
      }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: zh["repair.rewrite"] }));

    await waitFor(async () => {
      expect((await flow.host.eventsOf("broken")).map((event) => event.seq)).toEqual([0, 1]);
    });
  });
});
