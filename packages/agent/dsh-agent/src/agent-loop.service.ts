// agent loop：上游 `AgentLoopService` 经 `fromCordis` 接管。
import AgentLoopService from "@deepseek-ai/dsh-agent-loop";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Llm } from "./llm.contract.ts";
import { SessionStore } from "@morlay/dsh-session";
import { SessionProjections } from "@morlay/dsh-session";
import { Tools } from "./tools.contract.ts";
import { AgentLoop } from "./agent-loop.contract.ts";
import { Agents } from "./agents.contract.ts";
import { SystemPrompt } from "./system-prompt.contract.ts";

@Injectable()
export class AgentLoopDefault extends fromCordis(AgentLoop, AgentLoopService) {
  agents = inject(Agents);

  sessions = inject(SessionStore);

  llm = inject(Llm);

  tools = inject(Tools);

  systemPrompt = inject(SystemPrompt);

  sessionProjections = inject(SessionProjections);

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
