import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as FileUploadPlugin from "@deepseek-ai/dsh-client-file-upload/client";

@Injectable()
export class FileUpload extends fromCordis({ name: "dsh-client-file-upload", apply: FileUploadPlugin.apply, inject: FileUploadPlugin.inject }) {
  protected override readonly nativeProvide = true;


  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
