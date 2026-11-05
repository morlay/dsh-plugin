// storage 聚合面：上游 `Storage` hub 经 `fromCordis` 接管，消费方 `inject(Storage)`。
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Storage } from "./contract/storage.contract.ts";
import { Storage as StorageHub } from "@deepseek-ai/dsh-storage";

@Injectable()
export class StorageDefault extends fromCordis(Storage, StorageHub) {
  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
