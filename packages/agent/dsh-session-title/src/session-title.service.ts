import { AgentDirectory } from "@morlay/dsh-agent";
import { SessionStore } from "@morlay/dsh-session";
import { SessionProjectionStore } from "@morlay/dsh-session";
import SessionTitleService from "@deepseek-ai/dsh-session-title";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { SessionTitle } from "./contract/session-title.contract.ts";

@Injectable()
export class SessionTitleDefault extends fromCordis(SessionTitle, SessionTitleService) {
  sessions = inject(SessionStore);

  sessionProjections = inject(SessionProjectionStore);

  agents = inject(AgentDirectory);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      sessions: this.sessions,
      sessionProjections: this.sessionProjections,
      agents: this.agents,
    });
  }
}
