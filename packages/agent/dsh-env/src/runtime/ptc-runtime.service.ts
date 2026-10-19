// PTC 运行时：上游 `NodePtcRuntimeService` 经 `fromCordis` 接管。
import NodePtcRuntimeService from "@deepseek-ai/dsh-ptc-runtime-node";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { FileSystem } from "../fs/fs.contract.ts";
import { Sandbox } from "../sandbox/sandbox.contract.ts";
import { SandboxPolicy } from "../sandbox-policy.contract.ts";
import { Subprocess } from "../sandbox/subprocess.contract.ts";
import { PtcRuntime } from "../ptc-runtime.contract.ts";

@Injectable()
export class PtcRuntimeDefault extends fromCordis(PtcRuntime, NodePtcRuntimeService) {
  fs = inject(FileSystem);

  subprocess = inject(Subprocess);

  sandbox = inject(Sandbox);

  sandboxPolicy = inject(SandboxPolicy);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      fs: this.fs,
      subprocess: this.subprocess,
      sandbox: this.sandbox,
      sandboxPolicy: this.sandboxPolicy,
    });
  }
}
