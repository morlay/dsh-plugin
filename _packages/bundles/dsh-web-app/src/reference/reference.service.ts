import { Agents } from "@morlay/dsh-base/agent";
import { WorkingDirectory } from "@morlay/dsh-base/sandbox";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import FileReferenceLocalPlugin from "@deepseek-ai/dsh-file-reference-local";

@Injectable()
export class FileReferenceLocal extends fromCordis(FileReferenceLocalPlugin) {
  agents = inject(Agents);

  workingDirectory = inject(WorkingDirectory);

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, { agents: this.agents, workingDirectory: this.workingDirectory });
  }
}
