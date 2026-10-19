// 工作目录：上游 `WorkingDirectoryService` 经 `fromCordis` 接管。
import { WorkingDirectoryService } from "@deepseek-ai/dsh-working-directory";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { WorkingDirectory } from "./working-directory.contract.ts";
import { SessionProjections } from "@morlay/dsh-base/session-projection";
import { SystemPrompt } from "@morlay/dsh-base/agent";
import { FileSystem } from "@morlay/dsh-base/fs";

@Injectable()
export class WorkingDirectoryDefault extends fromCordis(WorkingDirectory, WorkingDirectoryService) {
  fs = inject(FileSystem);

  sessionProjections = inject(SessionProjections);

  systemPrompt = inject(SystemPrompt);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, {
      fs: this.fs,
      sessionProjections: this.sessionProjections,
      systemPrompt: this.systemPrompt,
    });
  }
}
