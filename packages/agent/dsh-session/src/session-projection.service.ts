import { SessionProjectionRegistry } from "@deepseek-ai/dsh-session-projection";
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { SessionProjections } from "./session-projection.contract.ts";

@Injectable()
export class SessionProjectionDefault extends fromCordis(SessionProjections, SessionProjectionRegistry) {
  /** 上游行按这个名字读（`inject: ["session-projections"]`）：显式落根 ctx。 */
  readonly name = "session-projections";

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
