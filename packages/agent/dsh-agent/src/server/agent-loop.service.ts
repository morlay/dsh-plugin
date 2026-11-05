// agent loop：上游 `AgentLoopService` 经 `fromCordis` 接管。
import AgentLoopService from "@deepseek-ai/dsh-agent-loop";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Llm } from "../contract/llm.contract.ts";
import { SessionStore } from "@morlay/dsh-session";
import { SessionProjectionStore } from "@morlay/dsh-session";
import { ToolRegistry } from "../contract/tool-registry.contract.ts";
import { AgentLoop } from "../contract/agent-loop.contract.ts";
import { AgentDirectory } from "../contract/agent-directory.contract.ts";
import { SystemPrompt } from "../contract/system-prompt.contract.ts";

@Injectable()
export class AgentLoopDefault extends fromCordis(AgentLoop, AgentLoopService) {

  agents = inject(AgentDirectory);

  sessions = inject(SessionStore);

  llm = inject(Llm);

  tools = inject(ToolRegistry);

  systemPrompt = inject(SystemPrompt);

  sessionProjections = inject(SessionProjectionStore);

  override async onInit(ctx: Context): Promise<void> {
    // `tools` / `systemPrompt` **不进 deps**：它们是真正的 cordis 服务（在 store 里），
    // 而 `deps` 会一路继承到 `agent.ctx`——上游 `file-reference-local` 用
    // `agent.ctx.inject(['systemPrompt','tools'], …)` 注册 per-agent 段落，一旦这两个名字走了
    // deps 短路，回调里拿到的是**我们的契约实例**，调用方 ctx 变成行 ctx（没有 scope 标记），
    // 段落于是掉进 global 层，第二个 agent 再注册同名段落就撞。
    await this.mount(ctx, undefined, {
      agents: this.agents,
      sessions: this.sessions,
      llm: this.llm,
      sessionProjections: this.sessionProjections,
    });
  }
}
