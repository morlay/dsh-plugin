// input（对话的输入区）跨行令牌。
import { InjectionToken } from "@morlay/zephyr";

/** `ctx.inputTriggers`（输入区 `/`、`@` 的触发源注册面）。 */
export const InputTriggers = new InjectionToken<unknown>("inputTriggers");
