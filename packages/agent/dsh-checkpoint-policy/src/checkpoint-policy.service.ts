import { Llm } from "@morlay/dsh-agent";
import { SessionStore } from "@morlay/dsh-session";
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import { ToolRegistry } from "@morlay/dsh-agent";
import * as SessionCheckpointPolicyPlugin from "@deepseek-ai/dsh-session-checkpoint-policy";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";



@Injectable()
export class SessionCheckpointPolicy extends fromCordis(SessionCheckpointPolicyPlugin) {
  llm = inject(Llm);

  sessionPersistence = inject(SessionPersistence);

  sessions = inject(SessionStore);

  tools = inject(ToolRegistry);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      llm: this.llm,
      sessionPersistence: this.sessionPersistence,
      sessions: this.sessions,
      tools: this.tools,
    });
  }
}
