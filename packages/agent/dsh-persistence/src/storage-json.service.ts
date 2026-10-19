// storage-json 后端行：装上游插件 `storage-json`，令牌就是适配类自身（与 `StorageDefault` 同一类行）。
//
// 它注册的是上游 `Storage` hub 的后端（名字 `json`），所以契约在 `@morlay/dsh-storage`：
// 这里的行**不声明自己的契约**，`contract/` 目录因此不存在。
import * as StorageJsonPlugin from "@deepseek-ai/dsh-storage-json";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Storage } from "@morlay/dsh-storage";

@Injectable()
export class StorageJsonDefault extends fromCordis(StorageJsonPlugin) {
  storage = inject(Storage);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, { storage: this.storage });
  }
}
