import { SessionProjectionRegistry } from "@deepseek-ai/dsh-session-projection";
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { SessionProjections } from "./contract.ts";

@Injectable()
export class SessionProjectionDefault extends fromCordis(SessionProjections, SessionProjectionRegistry) {
  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
