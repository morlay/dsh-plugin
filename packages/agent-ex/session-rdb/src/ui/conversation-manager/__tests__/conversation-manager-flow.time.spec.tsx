// @vitest-environment happy-dom
// L3：时间 chip → 宿主按**本地自然日**窗口返回行（真宿主 + 真端点客户端 + 真页面）。
//
// 窗口的边界由日历定：近 7 天 = 今天本地零点往前 6 天。「滚动窗口」（此刻 - 7 × 24h）与它的差
// 就落在今天已经过去的那几个小时里——用例把一行钉在那段差里：自然日口径看不到它，滚动口径会看到。
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test } from "@morlay/session-rdb/testing";
import { onTestFinished } from "vitest";
import { zh } from "../locales.ts";
import {
  seedSessionAt,
  startManagerFlow,
  type ManagerFlow,
} from "../../../__tests__/support/manager-flow.ts";
import { renderManagerPage } from "../../../__tests__/support/manager-render.tsx";

async function start(): Promise<ManagerFlow> {
  const flow = await startManagerFlow();
  onTestFinished(() => flow.dispose());
  return flow;
}

describe("L3 对话管理页：时间筛选", () => {
  test("近 7 天从本地零点算起：只有滚动窗口才会包含的那一行被排除", async () => {
    const flow = await start();
    // 近 7 天的下界：今天零点往前 6 天（本地时区）。
    const lower = new Date();
    lower.setHours(0, 0, 0, 0);
    lower.setDate(lower.getDate() - 6);
    const rollingStart = Date.now() - 7 * 86_400_000;
    // 滚动窗口包含、自然日窗口不包含的一段：两个下界之间。
    const gap = Math.floor(rollingStart + (lower.getTime() - rollingStart) / 2);
    await seedSessionAt(flow.host, "edge-in", "窗口内的会话", lower.getTime() + 60_000);
    await seedSessionAt(flow.host, "rolling-only", "滚动窗口才有的会话", gap);
    const container = renderManagerPage(flow);

    await screen.findByText("窗口内的会话");
    await screen.findByText("滚动窗口才有的会话");

    const group = container.querySelector('[data-filter="time"]');
    if (!(group instanceof HTMLElement)) throw new Error("missing time filter group");
    fireEvent.click(within(group).getByRole("button", { name: zh["filter.time.7d"] }));

    await waitFor(() => {
      expect(screen.queryByText("滚动窗口才有的会话")).toBeNull();
    });
    // 窗口内的那一行照常返回（不是把整段筛选关掉）。
    expect(screen.getByText("窗口内的会话")).toBeTruthy();
  });
});
