// 工具执行器（纯实现行，不声明契约）：上游把「谁执行工具」拆成了独立插件，
// 0.2.2 起 agent loop 在 turn 开始时要求作用域里已经选定执行器，否则整轮直接以
// `selected tool executor is unavailable` 结束（表现为假 LLM 一次都没被调用）。
//
// 默认选 native：工具在宿主进程内直接跑（`ToolRuntime.execute` 的批量入口）。
import * as ToolExecutorNativePlugin from "@deepseek-ai/dsh-tool-executor-native";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { ToolRegistry } from "../contract/tool-registry.contract.ts";

@Injectable()
export class ToolExecutorNative extends fromCordis(ToolExecutorNativePlugin) {
  tools = inject(ToolRegistry);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, { tools: this.tools });
  }
}
