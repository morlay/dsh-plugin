import * as SessionLogDeepseekPlugin from "@deepseek-ai/dsh-session-log-deepseek";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { DeepseekLlmApiExtensions } from "@morlay/dsh-base/llm";
import { SessionStore } from "@morlay/dsh-base/session";

@Injectable()
export class SessionLogDeepseek extends fromCordis(SessionLogDeepseekPlugin) {
  deepseekLlmApiExtensions = inject(DeepseekLlmApiExtensions);

  sessions = inject(SessionStore);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, {
      deepseekLlmApiExtensions: this.deepseekLlmApiExtensions,
      sessions: this.sessions,
    });
  }
}
