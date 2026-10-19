import { SessionStore } from "@morlay/dsh-session";
import { SessionProjections } from "@morlay/dsh-session";
import SessionTitleService from "@deepseek-ai/dsh-session-title";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { SessionTitle } from "./session-title.contract.ts";

@Injectable()
export class SessionTitleDefault extends fromCordis(SessionTitle, SessionTitleService) {
  sessions = inject(SessionStore);

  sessionProjections = inject(SessionProjections);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      sessions: this.sessions,
      sessionProjections: this.sessionProjections,
    });
  }
}
