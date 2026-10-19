// 工作目录：上游 `WorkingDirectoryService` 经 `fromCordis` 接管。
import { WorkingDirectoryService } from "@deepseek-ai/dsh-working-directory";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { WorkingDirectory } from "../working-directory.contract.ts";
import { SessionProjections } from "@morlay/dsh-session";
import { SystemPrompt } from "@morlay/dsh-agent";
import { FileSystem } from "../fs/fs.contract.ts";

@Injectable()
export class WorkingDirectoryDefault extends fromCordis(WorkingDirectory, WorkingDirectoryService) {
  fs = inject(FileSystem);

  sessionProjections = inject(SessionProjections);

  systemPrompt = inject(SystemPrompt);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      fs: this.fs,
      sessionProjections: this.sessionProjections,
      systemPrompt: this.systemPrompt,
    });
  }
}
