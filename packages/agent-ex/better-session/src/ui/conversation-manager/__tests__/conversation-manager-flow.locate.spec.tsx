// @vitest-environment happy-dom
// L3：会话内定位事件——真宿主 + 真端点客户端 + 真页面，条件下推到宿主，只回 seq 窗口与命中片段。
//
// 判据是「命中哪几行、片段里有什么、窗口是哪一段」；定位是只读的，修法是另一条入口。
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { zh } from "../locales.ts";
import {
  seedToolSession,
  startManagerFlow,
  type ManagerFlow,
} from "../../../__tests__/support/manager-flow.ts";
import { renderManagerPage } from "../../../__tests__/support/manager-render.tsx";

afterEach(cleanup);

const flows: ManagerFlow[] = [];

afterEach(async () => {
  for (const flow of flows.splice(0)) await flow.dispose();
});

async function start(): Promise<ManagerFlow> {
  const flow = await startManagerFlow();
  flows.push(flow);
  return flow;
}

// 命中那条的 seq 与整段日志的长度（窗口的上界就是长度 - 1）。
async function seedLocated(flow: ManagerFlow): Promise<{ seq: number; last: number }> {
  const seq = await seedToolSession(flow.host, "locate-l3", "要定位的会话", "read");
  const events = await flow.host.eventsOf("locate-l3");
  return { seq, last: events.length - 1 };
}

describe("L3 对话管理页：事件定位", () => {
  it("按工具名定位：回命中那条的 seq 与片段，窗口是整段日志，列表只读", async () => {
    const flow = await start();
    const { seq, last } = await seedLocated(flow);
    const container = renderManagerPage(flow);
    await screen.findByText("要定位的会话");

    fireEvent.click(
      within(container).getByRole("button", {
        name: zh["locateNamed"].replace("{title}", "要定位的会话"),
      }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(zh["locate.name"]), {
      target: { value: "read" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: zh["locate.run"] }));

    await waitFor(() => {
      expect(dialog.querySelector('[data-locate="results"]')).not.toBeNull();
    });
    const results = dialog.querySelector('[data-locate="results"]');
    expect(results?.getAttribute("data-locate-window")).toBe("0-" + String(last));
    const hits = dialog.querySelectorAll("[data-locate-hit]");
    expect([...hits].map((hit) => hit.getAttribute("data-locate-hit"))).toEqual([String(seq)]);
    // 片段是事件语义文本或原文：工具名是命中点，应该出现在片段里。
    expect(hits[0]?.textContent).toContain("read");
    // 只读：命中列表里没有动作按钮。
    expect(results?.querySelector("button")).toBeNull();

    // 换条件重新定位：类型 user/message 只回用户输入那一条。
    fireEvent.change(within(dialog).getByLabelText(zh["locate.name"]), { target: { value: "" } });
    fireEvent.change(within(dialog).getByLabelText(zh["locate.type"]), {
      target: { value: "user/message" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: zh["locate.run"] }));

    await waitFor(() => {
      expect(dialog.querySelectorAll("[data-locate-hit]")).toHaveLength(1);
    });
    expect(dialog.querySelector("[data-locate-hit]")?.getAttribute("data-locate-hit")).not.toBe(
      String(seq),
    );
  });
});
