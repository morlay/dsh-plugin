// storage-json 后端行：纯实现（不声明契约），令牌就是适配类自身。
import * as StorageJsonPlugin from "@deepseek-ai/dsh-storage-json";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Storage } from "./storage.contract.ts";

@Injectable()
export class StorageBackendJson extends fromCordis(StorageJsonPlugin) {
  storage = inject(Storage);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, { storage: this.storage });
  }
}
