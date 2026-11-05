// 工具执行器（适配行，不声明对外服务）：上游把「谁执行工具」拆成了独立插件。
//
// 上游导出的是「一个普通类 + 一个 `apply`」：
//
//   export class NativeToolExecutor implements ToolExecutor { constructor(ctx, maxParallel?) }
//   export function apply(ctx) { ctx.tools.setExecutor(new NativeToolExecutor(ctx)) }
//
// **为什么仍然需要 `fromCordis`（而不是直接 `new NativeToolExecutor(ctx)`）**：
// 那个类是按 **cordis ctx 语义**写的——构造里 `new ToolExecutionPipeline(ctx)`，pipeline 读 `ctx.tools`。
// 而我们 Provider 的 `onInit(ctx)` 拿到的是 cordis 行 ctx，`tools` 是我们的令牌、不在 cordis 名字表上，
// 直接构造会抛 `cannot get property "tools" without inject`。
// `fromCordis` 的 `mount(ctx, undefined, { tools })` 正是把 deps 放进这一行的作用域，
// 让上游类按它期望的方式读到 `tools`——这一层不是多余的包装，是**语义适配**。
//
// 为什么这一行必须存在：0.2.2 起 agent loop 在 turn 开始时要求作用域里已经选定执行器，
// 否则整轮直接以 `selected tool executor is unavailable` 结束（假 LLM 一次都不会被调用）。
import * as ToolExecutorNativePlugin from "@deepseek-ai/dsh-tool-executor-native";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { ToolRegistry } from "../contract/tool-registry.contract.ts";

@Injectable()
export class ToolExecutorNative extends fromCordis(ToolExecutorNativePlugin) {
  tools = inject(ToolRegistry);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, { tools: this.tools });
  }
}
