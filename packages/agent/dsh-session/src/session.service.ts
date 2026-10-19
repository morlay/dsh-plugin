// 默认实现：上游 `SessionStore` 服务类经 `fromCordis` 接管到契约令牌上。
import SessionStoreService from "@deepseek-ai/dsh-session";
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { SessionStore } from "./session.contract.ts";

@Injectable()
export class SessionStoreDefault extends fromCordis(SessionStore, SessionStoreService) {
  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
