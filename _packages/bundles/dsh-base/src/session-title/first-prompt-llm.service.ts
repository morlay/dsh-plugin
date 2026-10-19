import * as SessionTitleLlmPlugin from "@deepseek-ai/dsh-session-title-first-prompt-llm";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Llm } from "@morlay/dsh-base/llm";
import { SessionStore } from "@morlay/dsh-base/session";
import { SessionTitle } from "@morlay/dsh-base/session-title";

@Injectable()
export class SessionTitleLlm extends fromCordis(SessionTitleLlmPlugin) {
  sessionTitle = inject(SessionTitle);

  llm = inject(Llm);

  sessions = inject(SessionStore);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, {
      sessionTitle: this.sessionTitle,
      llm: this.llm,
      sessions: this.sessions,
    });
  }
}
