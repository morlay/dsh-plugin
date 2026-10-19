// 远程访问：上游 `RemoteAccessService` 经 `fromCordis` 接管。
import RemoteAccessService from "@deepseek-ai/dsh-api-remote-access";
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { RemoteAccess } from "./remote-access.contract.ts";

@Injectable()
export class RemoteAccessDefault extends fromCordis(RemoteAccess, RemoteAccessService) {
  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
