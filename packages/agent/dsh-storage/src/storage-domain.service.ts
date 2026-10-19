// storage-domain 行：把 storage 域挂到数据面上，提供 `storageDomain` 设施。
import * as StorageDomainPlugin from "@deepseek-ai/dsh-storage-domain";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Storage } from "./storage.contract.ts";
import { StorageDomain } from "./storage-domain.contract.ts";

@Injectable()
export class StorageDomainDefault extends fromCordis(StorageDomain, StorageDomainPlugin) {
  storage = inject(Storage);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, { storage: this.storage });
  }
}
