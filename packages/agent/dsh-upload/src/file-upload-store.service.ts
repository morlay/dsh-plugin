// `fileUploads` 的宿主行：上游 `FileUploads` 本身就是完整服务（`super(ctx, 'fileUploads')`、注册 HTTP
// 上传路由与命令回执解析器、观察会话事件），本包不重新实现，只把它接到我们已装的四个服务上。
import { FileUploads } from "@deepseek-ai/dsh-client-file-upload";
import { AgentDirectory } from "@morlay/dsh-agent";
import { AttachmentStore } from "@morlay/dsh-attachment";
import { CommandRegistry } from "@morlay/dsh-command";
import { Connection } from "@morlay/zephyr-app";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { FileUploadStore } from "./contract/file-upload-store.contract.ts";

@Injectable()
export class FileUploadStoreDefault extends fromCordis(FileUploadStore, FileUploads) {
  private readonly agents = inject(AgentDirectory);

  private readonly attachments = inject(AttachmentStore);

  private readonly commands = inject(CommandRegistry);

  private readonly connection = inject(Connection);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      agents: this.agents,
      attachments: this.attachments,
      commands: this.commands,
      connection: this.connection,
    });
  }
}
