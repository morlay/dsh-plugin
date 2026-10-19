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

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      agents: this.agents,
      sessions: this.sessions,
      llm: this.llm,
      tools: this.tools,
      systemPrompt: this.systemPrompt,
      sessionProjections: this.sessionProjections,
    });
  }
}
