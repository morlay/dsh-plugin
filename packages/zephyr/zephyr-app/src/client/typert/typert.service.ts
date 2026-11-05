// Typert 契约的 client 半：上游 `dsh-typert-registry/client` 提供 `typert` 服务（gateway 的 client 半读它）。
import * as TypertClientPlugin from "@deepseek-ai/dsh-typert-registry/client";
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Typert } from "../../typert/typert.contract.ts";

@Injectable()
export class ClientTypertDefault extends fromCordis(Typert, TypertClientPlugin) {
  async onInit(ctx: Context): Promise<void> {
    // 上游 `typert-registry` 自己 `ctx.inject` 等依赖，本行不接管。
    await this.mount(ctx, undefined, {});
  }
}
