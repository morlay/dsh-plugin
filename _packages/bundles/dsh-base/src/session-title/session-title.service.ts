import { SessionStore } from "@morlay/dsh-base/session";
import { SessionProjections } from "@morlay/dsh-base/session-projection";
import SessionTitleService from "@deepseek-ai/dsh-session-title";
import { SessionProjectionRegistry } from "@deepseek-ai/dsh-session-projection";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { SessionTitle } from "./contract.ts";

@Injectable()
export class SessionTitleDefault extends fromCordis(SessionTitle, SessionTitleService) {
  sessions = inject(SessionStore);

  sessionProjections = inject(SessionProjections);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, {
      sessions: this.sessions,
      sessionProjections: this.sessionProjections,
    });
  }
}
