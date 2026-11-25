/**
 * 应用侧 client 装配的**整链判据**：装 `appClientProviders()` 之后，上游行按名字要的那些面都在。
 *
 * 为什么要这条：上游行在 apply 里按名字读服务（`ctx.uiSession.sessionStatus` 这类子服务也是按名解析），
 * 漏一条不会在装配期报错，而是浏览器里 `cannot get property "…" without inject` 白屏。
 * 这里装真清单、断言关键面可读——它是"前端起不来"这类问题的第一道网。
 */
import { bootstrapApplication } from "@morlay/zephyr";
import { Slots } from "@morlay/zephyr-app/client";
import { describe, expect, test } from "@morlay/zephyr/testing";
import { onTestFinished } from "vitest";
import { appClientProviders } from "../client.provide.ts";

describe("应用 client 装配", () => {
  // **已知失败**（`test.fails` 标注，修好那天它会报"不该失败却通过了"）：
  // `ui-workspace` 的 apply 读 `ctx.uiSession.sessionStatus` 时抛 `without inject`。
  // 探针（`ZEPHYR_DEBUG_PROXY=1`）确认：`ctx.uiSession` 命中 deps，但**子服务名那次读从未经过
  // 我们的代理**——它落在 `uiSession` 实例自己的 ctx 上。机制与已排除的解法见
  // `.agents/debts/20261123-上游子服务的属性读在代理ctx下不可用.md`。
  test("整链装得起来，且上游行按名要的连接面与子服务都在", async () => {
    const app = await bootstrapApplication({
      providers: [...appClientProviders()],
      timeoutMs: 30_000,
    } as never);
    onTestFinished(() => app.dispose().catch(() => {}));
    const ctx = (app as unknown as { ctx: { get(name: string, strict?: boolean): unknown } }).ctx;

    // 浏览器连接面与它的名字（上游 `ui-workspace` / `ClientRemoteService` 按 `connection` 读）。
    expect(ctx.get("client-connection", false), "浏览器连接面").not.toBeUndefined();
    expect(ctx.get("connection", false), "上游按名读的 connection").not.toBeUndefined();

    // `uiSession` 与它的子服务（上游 `ui-workspace` 的 inject 声明里有这两个名字）。
    expect(ctx.get("uiSession", false), "uiSession").not.toBeUndefined();
    expect(
      ctx.get("uiSession.sessionStatus", false),
      "uiSession.sessionStatus（子服务，由 ui-session-status 行发布）",
    ).not.toBeUndefined();

    // 会话面板区（0.2.3 起 `job-list` / `subagent-list` 的位置）：声明方是上游 `ui-session-panel`。
    // 它不在时这些注册无处挂——条目不会出现在界面上，也不报错。
    const slots = app.get(Slots);
    expect(
      slots.entries("conversation.session.panel.section").length,
      "conversation.session.panel.section（job / subagent 的条目父级）",
    ).toBeGreaterThan(0);
    expect(
      slots.entries("conversation.chat.aside").length,
      "conversation.chat.aside（面板容器）",
    ).toBeGreaterThan(0);
  }, 60_000);
});
