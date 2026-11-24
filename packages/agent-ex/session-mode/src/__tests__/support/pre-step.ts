// 测试里的**一步派发**：`agent/pre-step` 是本包装配行订阅的上游水瀑。
//
// 水瀑有两个面：监听者那面是「参数表 + next」，派发那面是「参数表 + 链底的那个 next」。本仓的事件类只收
// 前一面（`onWaterfall` 自己接 next），所以派发落到 ctx 的水瀑口子上；事件名就是**上游契约名**
// `agent/pre-step`（本包各行订阅的也是它，见 `events.ts` 的 `AgentPreStep`）——不按令牌名去 ctx 里翻实例，
// payload 与返回仍按本包的 `PreStepPayload` / `PreStepDecision` 检查：少写一个字段在这里就编不过。
import type { Next } from "@morlay/zephyr";
import type { PreStepDecision, PreStepPayload } from "../../events.ts";
import type { TestContext } from "./context.ts";

/** 本包各行订阅的上游水瀑名（契约名，不是派生服务名）。 */
const kPreStep = "agent/pre-step";

/**
 * 派发一次 `agent/pre-step` 水瀑。
 * @param ctx - 根 ctx（派发口子；监听者按注册顺序嵌套）。
 * @param payload - 这一步的事实（字段见 `PreStepPayload`）。
 * @param next - 链底的默认决定：`enter` 带这一步进模型的消息。
 * @returns 链的最终决定。
 */
export function dispatchPreStep(
  ctx: TestContext,
  payload: PreStepPayload,
  next: Next<Promise<PreStepDecision>>,
): Promise<PreStepDecision> {
  return ctx.waterfall<Promise<PreStepDecision>>(kPreStep, payload, next);
}
