// 按 agent 装配的两行：**每个 agent 的 `agentCtx` 各装一份**，事件订阅随之落在那个 agent 的 scope 里。
//
// 为什么必须是独立的行：团队 / schedule / 按需组这些能力在会话建好**之后**才往 agent scope 注册工具，
// 根上的 `tools/change` 看不到它们；而 `agent/request` 的默认模型兜底也要按 agent 现算模式。
// 声明 `@AgentScoped()` 就够了——事件字段绑的是装这一行时用的 ctx，不需要谁把 ctx 显式传进来。
import type { Agent, LlmCallConfig } from "@morlay/dsh-agent/contract";
import { AgentScoped, agentOfScope, Events } from "@morlay/dsh-agent/contract";
import { ToolRegistry } from "@morlay/dsh-agent";
import { inject, Injectable, type Context, type OnInit } from "@morlay/zephyr";
import { projectDefinition } from "./tool-guidance.service.ts";
import { SessionModeDefault } from "./session-mode.service.ts";

/**
 * 这个 agent 的工具投影：建好时改一遍，之后跟**它自己的** `tools/change`。
 *
 * 判据与根上那条一致（说明字段改一行中文、schema 只留约束），区别只在订阅挂在哪个 scope。
 */
@AgentScoped()
@Injectable()
export class ScopedToolGuidance implements OnInit {
  /** 本 agent 的工具面变化：字段事件，装配器把它绑到这一行所在的 ctx。 */
  readonly changed$ = new Events.ToolChange();

  private readonly tools = inject(ToolRegistry);

  onInit(ctx: Context): void {
    const agent = agentOfScope(ctx);
    if (agent === undefined) return;
    const projectAll = (target: Agent): void => {
      for (const definition of this.tools.definitions(target)) projectDefinition(definition);
    };
    projectAll(agent);
    this.changed$.on(() => projectAll(agent));
  }
}

/**
 * 这个 agent 的默认模型兜底：`agent/request` 瀑布上，会话尚无模型事实时按模式配置接管路由。
 *
 * 位置：订阅装在 agent 的 scope 上（per-agent 行），模式在请求时现读——换模式不需要重装监听，
 * 也不会因为根上一条监听而串到别的会话。
 */
@AgentScoped()
@Injectable()
export class ScopedAgentRequest implements OnInit {
  /** 本 agent 的模型请求（瀑布）：字段事件，绑这一行所在的 ctx。 */
  readonly request$ = new Events.AgentRequest();

  /** 模式本体：**可选**——只装 `ToolGuidance` 的极简装配没有它，那时不做默认模型兜底。 */
  private readonly modes = inject.optional(SessionModeDefault);

  onInit(ctx: Context): void {
    const agent = agentOfScope(ctx);
    const modes = this.modes;
    if (agent === undefined || modes === undefined) return;
    this.request$.onWaterfall(async (payload, next): Promise<LlmCallConfig> => {
      const resolved = await next();
      if (payload.agent !== agent) return resolved;
      return modes.applyDefaultModel(agent, resolved);
    });
  }
}
