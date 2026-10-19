// PTC 运行时：上游 `NodePtcRuntimeService` 经 `fromCordis` 接管。
import NodePtcRuntimeService from "@deepseek-ai/dsh-ptc-runtime-node";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { FileSystem } from "@morlay/dsh-base/fs";
import { Sandbox, SandboxPolicy, Subprocess } from "@morlay/dsh-base/sandbox";
import { PtcRuntime } from "./ptc-runtime.contract.ts";

@Injectable()
export class PtcRuntimeDefault extends fromCordis(PtcRuntime, NodePtcRuntimeService) {
  fs = inject(FileSystem);

  subprocess = inject(Subprocess);

  sandbox = inject(Sandbox);

  sandboxPolicy = inject(SandboxPolicy);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, {
      fs: this.fs,
      subprocess: this.subprocess,
      sandbox: this.sandbox,
      sandboxPolicy: this.sandboxPolicy,
    });
  }
}
