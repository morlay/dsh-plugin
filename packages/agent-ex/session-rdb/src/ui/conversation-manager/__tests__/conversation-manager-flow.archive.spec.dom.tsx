// L3：归档链路走**真面**——行上点归档 → workspace 域的归档集合经 storage 接管写穿到会话行
// （与生产同一条 `syncSessionFlags`），页面接着按同一份标记过滤。
//
// 只替换模型的输出；归档、列表与筛选全走真 remote 到真库。
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test } from "@morlay/session-rdb/testing";
import { onTestFinished } from "vitest";
import { zh } from "../locales.ts";
import {
  archiveSessionsInDb,
  deleteSessionInDb,
  seedTitledSession,
  startManagerFlow,
  type ManagerFlow,
} from "../../../__tests__/support/manager-flow.ts";
import { renderManagerPage } from "../../../__tests__/support/manager-render.tsx";

async function start(): Promise<ManagerFlow> {
  const flow = await startManagerFlow();
  onTestFinished(() => flow.dispose());
  return flow;
}

// 归档 chip 那一组。
function archivedGroup(container: HTMLElement): HTMLElement {
  const group = container.querySelector('[data-filter="archived"]');
  if (!(group instanceof HTMLElement)) throw new Error("missing archived filter group");
  return group;
}

describe("L3 对话管理页：归档", () => {
  test("行上点归档 → 标记进库、归档 chip 的过滤立刻生效", async () => {
    const flow = await start();
    await seedTitledSession(flow.host, "archive-one", "要归档的会话");
    await seedTitledSession(flow.host, "keep-one", "留着的会话");
    const container = renderManagerPage(flow);

    await screen.findByText("要归档的会话");
    fireEvent.click(
      within(container).getByRole("button", {
        name: zh["archiveNamed"].replace("{title}", "要归档的会话"),
      }),
    );

    // 重拉后的行读的是库里的标记：那一行出现「已归档」。
    await waitFor(() => {
      expect(screen.getByText(zh.archived)).toBeTruthy();
    });
    // 归档后的过滤是宿主侧的事：仅已归档只剩它，未归档只剩另一条。
    const group = archivedGroup(container);
    fireEvent.click(within(group).getByRole("button", { name: zh["filter.archived.only"] }));
    await waitFor(() => {
      expect(screen.queryByText("留着的会话")).toBeNull();
    });
    expect(screen.getByText("要归档的会话")).toBeTruthy();

    fireEvent.click(within(group).getByRole("button", { name: zh["filter.archived.unarchived"] }));
    await waitFor(() => {
      expect(screen.getByText("留着的会话")).toBeTruthy();
    });
    expect(screen.queryByText("要归档的会话")).toBeNull();
    // 归档集合本身也真的变了（读 workspace 域，经 storage 接管；页面过滤读的就是这一份写穿的标记）。
    expect(await flow.archivedSessionIds()).toEqual(["archive-one"]);
  });
});
describe("L3 对话管理页：批量归档", () => {
  test("多选两行批量归档：逐条结算，失败那条的会话与原因进聚合提示", async () => {
    const flow = await start();
    await seedTitledSession(flow.host, "bulk-archive-a", "甲会话");
    await seedTitledSession(flow.host, "bulk-archive-b", "乙会话");
    const container = renderManagerPage(flow);

    await screen.findByText("甲会话");
    fireEvent.click(
      screen.getByRole("checkbox", { name: zh["selectNamed"].replace("{title}", "甲会话") }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: zh["selectNamed"].replace("{title}", "乙会话") }),
    );

    // 乙会话在确认之前从库里删掉（页面上的那行成了过期行）：归档它必然失败，另一条照常归档。
    await archiveSessionsInDb(flow.host, ["bulk-archive-b"]);
    await deleteSessionInDb(flow.host, "bulk-archive-b");

    fireEvent.click(
      within(container).getByRole("button", {
        name: zh["bulk.archiveNamed"].replace("{count}", "2"),
      }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: zh["bulkArchive.confirmAccept"] }));

    // 聚合提示：成功几条、失败几条，再把未归档那条的会话与原因带出来（未知会话是可读文案）。
    await waitFor(() => {
      expect(container.querySelector('[data-notice="result"]')).not.toBeNull();
    });
    const notice = container.querySelector('[data-notice="result"]')?.textContent ?? "";
    expect(notice).toContain("已归档 1 条会话，1 条失败。");
    expect(notice).toContain("bulk-archive-b");
    expect(notice).toContain(zh["failure.missing"]);
    expect(await flow.archivedSessionIds()).toContain("bulk-archive-a");
  });
});
