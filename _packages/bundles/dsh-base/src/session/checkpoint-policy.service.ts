import { Llm } from "@morlay/dsh-base/llm";
import { SessionStore } from "@morlay/dsh-base/session";
import { Tools } from "@morlay/dsh-base/tool";
import * as SessionCheckpointPolicyPlugin from "@deepseek-ai/dsh-session-checkpoint-policy";
import { LlmRuntime } from "@deepseek-ai/dsh-llm";
import { ToolRuntime } from "@deepseek-ai/dsh-tools";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";

import { SessionPersistence } from "@morlay/dsh-base/session";


@Injectable()
export class SessionCheckpointPolicy extends fromCordis(SessionCheckpointPolicyPlugin) {
  llm = inject(Llm);

  sessionPersistence = inject(SessionPersistence);

  sessions = inject(SessionStore);

  tools = inject(Tools);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, {
      llm: this.llm,
      sessionPersistence: this.sessionPersistence,
      sessions: this.sessions,
      tools: this.tools,
    });
  }
}
