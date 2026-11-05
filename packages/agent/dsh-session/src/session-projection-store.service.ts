import { SessionProjectionRegistry } from "@deepseek-ai/dsh-session-projection";
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { SessionProjectionStore } from "./contract/session-projection-store.contract.ts";

@Injectable()
export class SessionProjectionStoreDefault extends fromCordis(SessionProjectionStore, SessionProjectionRegistry) {
  /** 上游投影注册表没有声明依赖：`mount` 只挂它自己（不传 deps，也不传 config）。 */
  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
