// 附件上传运行时（`ctx.fileUpload`）：上游 `file-upload` 的运行时是 cordis `Service` 子类，
// 构造里 `super(ctx, "fileUpload")` 把自己注册进 store。
//
// **为什么不用上游那个 `apply`**：它只做一件事——`ctx.plugin(FileUploadRuntime)`，那个子 fiber 挂在
// **本行**下面。而按名字读服务（`ctx.fileUpload` 的严格读）只认**祖先 fiber** 上的 provision 或根 ctx 上的
// 注册：会话界面的 `ConversationController` 里 `this.ctx` 是会话 scope ctx（`ClientSessions.createScope`
// 建的，链只到根），于是抛 `cannot get property "fileUpload" without inject`——真机上的现象正是
// 「粘贴图片 → chip 变红、没有上传请求」（实测栈落在 `pumpFileUploads`）。
//
// 所以按 `fromCordis` 的 **Service 分支**接（与 `WebTerminalsDefault` 用根 ctx 建 `ClientTerminals` 同一落点）：
// 服务由根 fiber 拥有，兄弟行与更深的 fiber 都读得到；契约面（`FileUpload`）就是那个实例。
import { FileUploadRuntime as UpstreamFileUploadRuntime } from "@deepseek-ai/dsh-client-file-upload/src/client/runtime.ts";
import { TYPERT_REMOTE as FILE_UPLOAD_REMOTE } from "@deepseek-ai/dsh-client-file-upload/remote";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Remote } from "@morlay/zephyr-app/client";
// 附件的行住在 upload 域（上游 `file-upload` 归这里）；契约的消费方是会话界面的输入区，
// 令牌由本包的 ui 面导出（upload 域不反向依赖它）。
import { FileUpload } from "../contract/index.ts";

@Injectable()
export class FileUploadRuntime extends fromCordis(FileUpload, UpstreamFileUploadRuntime) {
  private readonly remote = inject(Remote);

  override async onInit(ctx: Context): Promise<void> {
    await this.remote.$mount(FILE_UPLOAD_REMOTE);
    // 上游构造里读 `ctx.remote`（`remote.fileUploads` 的字节上传走它）：按 deps 交进去。
    await this.mount(ctx, undefined, { remote: this.remote });
  }
}
