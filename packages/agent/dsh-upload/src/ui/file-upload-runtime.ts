// 附件上传运行时（`ctx.fileUpload`）：上游 `file-upload` 的 apply 只做一件事——`ctx.plugin(FileUploadRuntime)`。
//
// 这里**照装那个插件**（`allowSubplugins` 逐行显式允许），服务的名字由 `fromCordis` 的
// `providerCtx.get("fileUpload")` 兜到，不需要另建一个"只构造"的壳。
import * as FileUploadPlugin from "@deepseek-ai/dsh-client-file-upload/client";
import { TYPERT_REMOTE as FILE_UPLOAD_REMOTE } from "@deepseek-ai/dsh-client-file-upload/remote";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Remote } from "@morlay/zephyr-app/client";
// 附件上传的行住在 upload 域（上游 `file-upload` 归这里）；它装进的是**会话界面**的输入区，
// 那个跨行令牌由会话域的 ui 面导出（upload → session 的单向依赖）。
import { FileUpload } from "./file-upload.token.ts";
import { FILE_UPLOADS_REMOTE_KEY } from "../endpoint/index.ts";

@Injectable()
export class FileUploadRuntime extends fromCordis(FileUpload, FileUploadPlugin) {
  private readonly remote = inject(Remote);

  override async onInit(ctx: Context): Promise<void> {
    await this.remote.$mount(FILE_UPLOAD_REMOTE);
    await this.mount(ctx, undefined, {
      remote: this.remote,
      [FILE_UPLOADS_REMOTE_KEY]: this.remote,
    });
  }
}
