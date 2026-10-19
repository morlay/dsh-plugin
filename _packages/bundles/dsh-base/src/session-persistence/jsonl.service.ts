import * as SessionPersistenceJsonlPlugin from "@deepseek-ai/dsh-session-persistence-jsonl";
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";

@Injectable()
export class SessionPersistenceJsonl extends fromCordis(SessionPersistenceJsonlPlugin) {
  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
