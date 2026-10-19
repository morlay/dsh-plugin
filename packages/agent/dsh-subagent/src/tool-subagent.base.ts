// 两个子代理工具行（`subagent` / `subagent_fork`）的**共同 body**：同一个上游插件、同一组注入、同一次
// `mount`；两者的差异全在装配面 `withConfig({ provider, toolName })` 上。
//
// 为什么是「共享基类 + 两个薄子类」而不是「一个类 `withConfig` 两次」：装配合并（zephyr 的
// `dedupeProviders`）按 `providerBase` 去重，而 `withConfig` 生成的子类把 `providerBase` 指回被配置的
// 那个类——同一个类配两次只会活下最后一条。两个子类各配一次才有两条 row 与两个工具名
// （守卫见 `__tests__/tool-subagent-rows.spec.ts`）。
//
// 基类**不能**标 `@Injectable()`：zephyr 的令牌元数据沿原型链复用，子类会因此共用基类的令牌。
// 另注：两个子类的**服务名**都取上游插件名（`tool-subagent`，适配类的既有口径），所以判别两条行的是
// 类身份、不是名字——别为了「名字不撞」把两个子类合成一个。
import * as ToolSubagentPlugin from "@deepseek-ai/dsh-tool-subagent";
import { inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { SystemPrompt, ToolRegistry } from "@morlay/dsh-agent";
import { SessionProjectionStore } from "@morlay/dsh-session";
import { SubagentRegistry } from "./contract/subagent-registry.contract.ts";

/** 子代理工具行的装配体：把上游 `tool-subagent` 要的依赖交给它。 */
export abstract class ToolSubagentBase extends fromCordis(ToolSubagentPlugin) {
  tools = inject(ToolRegistry);

  subagents = inject(SubagentRegistry);

  systemPrompt = inject(SystemPrompt);

  sessionProjections = inject(SessionProjectionStore);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      tools: this.tools,
      subagents: this.subagents,
      systemPrompt: this.systemPrompt,
      sessionProjections: this.sessionProjections,
    });
  }
}
