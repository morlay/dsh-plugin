import TerminalControllerPlugin from "@deepseek-ai/dsh-api-terminal-controller";
import { SandboxPolicy, Subprocess, WorkingDirectory } from "@morlay/dsh-base/sandbox";
import { Typert } from "@morlay/dsh-base/typert";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";

@Injectable()
export class TerminalController extends fromCordis(TerminalControllerPlugin) {
  subprocess = inject(Subprocess);

  sandboxPolicy = inject(SandboxPolicy);

  workingDirectory = inject(WorkingDirectory);

  typert = inject(Typert);

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, { subprocess: this.subprocess, sandboxPolicy: this.sandboxPolicy, workingDirectory: this.workingDirectory, typert: this.typert });
  }
}
