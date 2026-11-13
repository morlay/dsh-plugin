/**
 * 执行器的**互斥选择**（native vs PTC）：一个 scope 只能有一个，装配面靠"剔一行、装一行"表达。
 *
 * 判据（原 `apps/zephyr-custom/src/__tests__/ptc-face.spec.ts` 里可下沉到包级的那一条）：
 * - `provideAgentLoop()` 自带 native 执行器；
 * - `provideAgentLoop(without(ToolExecutorNative))` 的清单里**没有**它，其余条目一个不少
 *   （PTC 就是靠这一步顶上去的）。
 *
 * **没下沉的两条**（留在上层：`just custom build` + 装配清单评审）：
 * 1. "PTC 生效后模型面只剩 `run_code`"——PTC 的两行是 `@AgentScoped()` 条目，直接列进清单会被
 *    `assertDslEntry` 当"未转换的 cordis 插件"拒掉，只能经 `PtcAgentGroup` 装，而 group 的消费方
 *    是装配面的 agent 分层设施；
 * 2. "两行同装时 `setExecutor` 抛错"——要在真有执行器的装配上验，同样卡在上一条。
 */
import { provideAgentLoop, ToolExecutorNative } from "@morlay/dsh-agent-loop";
import { without } from "@morlay/zephyr";
import { describe, expect, it } from "vitest";

describe("执行器的互斥选择", () => {
  it("基础清单自带 native 执行器", () => {
    expect(provideAgentLoop()).toContain(ToolExecutorNative);
  });

  it("剔掉 native 后清单里没有它，其余条目一个不少", () => {
    const withNative = provideAgentLoop();
    const withoutNative = provideAgentLoop(without(ToolExecutorNative));
    expect(withoutNative).not.toContain(ToolExecutorNative);
    expect(withoutNative.length).toBe(withNative.length - 1);
  });
});
