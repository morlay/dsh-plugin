// storage 聚合面：上游 `Storage` hub 经 `fromCordis` 接管，消费方 `inject(Storage)`。
import { Storage as StorageHub } from "@deepseek-ai/dsh-storage";
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Storage } from "./storage.contract.ts";

@Injectable()
export class StorageDefault extends fromCordis(Storage, StorageHub) {
  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
