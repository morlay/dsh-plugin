// PTC 执行器（适配行，不声明对外服务）：上游把「谁执行工具」拆成独立插件，PTC 就是其中一份。
//
// 上游导出的是「一个普通类 + 一个 apply」：
//
//   export const name = 'ptc-tool-executor'
//   export const inject = ['tools', 'systemPrompt', 'ptcRuntime']
//   export function apply(ctx, config) { ctx.tools.setExecutor(new PtcExecutor(ctx, config)) }
//
// 它做两件事，都是**只有它能做**的：把 `tools:sdk` 这一段 system 换成 PTC 骨架、把模型面收成
// `run_code` 一条（`describe()` 只给保留名那一条）。所以「装了 `ptcRuntime`」不等于「PTC 生效」——
// 缺这一行时装配照常起来、会话照常建，只是模型面还是普通工具清单，且没有任何报错。
//
// 与 `ToolExecutorNative` 同构（见 `@morlay/dsh-agent` 的 `tool-executor.service.ts`）：
// 上游类按 cordis ctx 语义写，`fromCordis` 的 `mount` 把 deps 放进这一行的作用域，
// 上游才读得到 `ctx.tools` / `ctx.systemPrompt` / `ctx.ptcRuntime`。
//
// **一个 scope 只能有一个执行器**（上游 `setExecutor` 抛 `Only one tool executor may be registered`）：
// 本行是**根作用域**的部署默认执行器，装上它就等于把部署的执行器选成 PTC——所以装配面不能再装 native 那一行。
import * as PtcExecutorPlugin from "@deepseek-ai/dsh-tool-executor-ptc";
import { SystemPrompt, ToolRegistry } from "@morlay/dsh-agent";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { PtcRuntime } from "./contract/ptc-runtime.contract.ts";

@Injectable()
export class ToolExecutorPtc extends fromCordis(PtcExecutorPlugin) {
  tools = inject(ToolRegistry);

  systemPrompt = inject(SystemPrompt);

  ptcRuntime = inject(PtcRuntime);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      tools: this.tools,
      systemPrompt: this.systemPrompt,
      ptcRuntime: this.ptcRuntime,
    });
  }
}
