// 附件上传运行时（`ctx.fileUpload`）：上游 `file-upload` 的 apply 只做一件事——`ctx.plugin(FileUploadRuntime)`。
//
// 这里**照装那个插件**（`allowSubplugins` 逐行显式允许），服务的名字由 `fromCordis` 的
// `providerCtx.get("fileUpload")` 兜到，不需要另建一个"只构造"的壳。
import * as FileUploadPlugin from "@deepseek-ai/dsh-client-file-upload/client";
import { TYPERT_REMOTE as FILE_UPLOAD_REMOTE } from "@deepseek-ai/dsh-client-file-upload/remote";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Remote } from "@morlay/zephyr-app/client";
import { FileUpload } from "./conversation.token.ts";

@Injectable()
export class FileUploadRuntime extends fromCordis(FileUpload, FileUploadPlugin) {
  private readonly remote = inject(Remote);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.remote.$mount(FILE_UPLOAD_REMOTE);
    await this.mount(ctx, undefined, { remote: this.remote, "remote.fileUploads": this.remote });
  }
}
