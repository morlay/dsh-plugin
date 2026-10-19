// 附件存储：上游 `LocalAttachmentStore` 经 `fromCordis` 接管。
import { LocalAttachmentStore } from "@deepseek-ai/dsh-attachment-local";
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { AttachmentStore } from "./contract/attachment-store.contract.ts";

@Injectable()
export class AttachmentStoreDefault extends fromCordis(AttachmentStore, LocalAttachmentStore) {
  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
