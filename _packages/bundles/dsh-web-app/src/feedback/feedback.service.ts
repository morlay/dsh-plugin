import { SessionStore, SessionPersistence } from "@morlay/dsh-base/session";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import MessageFeedbackPlugin from "@deepseek-ai/dsh-message-feedback";

@Injectable()
export class MessageFeedback extends fromCordis(MessageFeedbackPlugin) {
  sessionPersistence = inject(SessionPersistence);

  sessions = inject(SessionStore);

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, {
      maxNoteBytes: 8192,
      sessionPersistence: this.sessionPersistence,
      sessions: this.sessions,
    });
  }
}
