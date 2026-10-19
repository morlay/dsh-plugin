// shell 执行器：上游 `SandboxBashExecutor` 经 `fromCordis` 接管。
import SandboxBashExecutor from "@deepseek-ai/dsh-bash-sandbox";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { ShellExecutor, Subprocess } from "@morlay/dsh-shell";
import { Sandbox } from "./contract/sandbox.contract.ts";
import { SandboxPolicy } from "./contract/sandbox-policy.contract.ts";

@Injectable()
export class BashSandbox extends fromCordis(ShellExecutor, SandboxBashExecutor) {
  subprocess = inject(Subprocess);

  sandbox = inject(Sandbox);

  sandboxPolicy = inject(SandboxPolicy);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      subprocess: this.subprocess,
      sandbox: this.sandbox,
      sandboxPolicy: this.sandboxPolicy,
    });
  }
}
