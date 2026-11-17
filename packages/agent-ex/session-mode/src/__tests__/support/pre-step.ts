// 测试里的**一步派发**：`agent/pre-step` 是本包装配行订阅的上游水瀑。
//
// 水瀑有两个面：监听者那面是「参数表 + next」，派发那面是「参数表 + 链底的那个 next」。本仓的事件类只收
// 前一面（`onWaterfall` 自己接 next），所以派发落到 ctx 的水瀑口子上；但**事件名取自装配行里那份事件
// 实例**（`ContextChannel` 的 `preStep$`，与它订阅的是同一条），payload 与返回按本包的 `PreStepPayload` /
// `PreStepDecision` 检查：少写一个字段（比如 `modelSelection`）在这里就编不过。
import { tokenMetaOf, type Next } from "@morlay/zephyr";
import { ContextChannel } from "../../context-assembler.provide.ts";
import type { PreStepDecision, PreStepPayload } from "../../events.ts";
import type { TestContext } from "./context.ts";

/**
 * 装配行订阅 `agent/pre-step` 用的那个事件名（取自通道行的 `preStep$`）。
 * @param ctx - 测试装配的根 ctx。
 * @returns cordis 事件名；通道行没装就是装配错误。
 */
function preStepNameOf(ctx: TestContext): string {
  const channel = ctx.get(tokenMetaOf(ContextChannel).name);
  if (!(channel instanceof ContextChannel)) {
    throw new Error("通道行没装：拿不到 agent/pre-step 的事件名");
  }
  return channel.preStep$.name;
}

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
  return ctx.waterfall<Promise<PreStepDecision>>(preStepNameOf(ctx), payload, next);
}
