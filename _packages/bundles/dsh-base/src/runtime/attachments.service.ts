// 附件存储：上游 `LocalAttachmentStore` 经 `fromCordis` 接管。
import { LocalAttachmentStore } from "@deepseek-ai/dsh-attachment-local";
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Attachments } from "./attachments.contract.ts";

@Injectable()
export class AttachmentsDefault extends fromCordis(Attachments, LocalAttachmentStore) {
  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
