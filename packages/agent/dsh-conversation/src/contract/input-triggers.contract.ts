// `ctx.inputTriggers`：输入区 `/`、`@` 的触发源注册面（上游 `ui-input-trigger` 行发布的服务）。
//
// 名字是上游注册名 `inputTriggers`（显式对齐，不靠类名派生）。行（`ui/input/input-trigger-slot.ts`）与
// 契约同在本包；技能域往输入区注册触发源时只认这个令牌。
//
// 契约类不带成员：消费方只把它交给上游插件的 `mount` deps；面见 `InputTriggersFace`。
import type { InputTriggerServiceContract } from "@deepseek-ai/dsh-client-ui-input-trigger/client";
import { Injectable } from "@morlay/zephyr";

/** `ctx.inputTriggers` 的面（上游 `InputTriggerServiceContract`：触发源注册与当前触发词）。 */
export type InputTriggersFace = InputTriggerServiceContract;

/** `ctx.inputTriggers`（输入区触发源注册面）：面见 `InputTriggersFace`。 */
@Injectable({ name: "inputTriggers" })
export abstract class InputTriggers {}
