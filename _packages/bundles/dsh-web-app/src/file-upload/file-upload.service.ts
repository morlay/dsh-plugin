import FileUploadPlugin from "@deepseek-ai/dsh-client-file-upload";
import { Agents } from "@morlay/dsh-base/agent";
import { Commands } from "@morlay/dsh-base/commands";
import { Attachments } from "@morlay/dsh-base/runtime";
import { Connection } from "@morlay/dsh-base/connection";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";

@Injectable()
export class FileUploads extends fromCordis(FileUploadPlugin) {
  agents = inject(Agents);

  attachments = inject(Attachments);

  commands = inject(Commands);

  connection = inject(Connection);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, {
      agents: this.agents,
      attachments: this.attachments,
      commands: this.commands,
      connection: this.connection,
    });
  }
}
