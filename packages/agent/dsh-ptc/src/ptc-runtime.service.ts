// PTC 运行时：上游 `NodePtcRuntimeService` 经 `fromCordis` 接管。
//
// **留在应用根**：判据是「同一个 agent 里的两个会话该不该共享它」——该共享。运行时的进程/执行面本身
// 按 `scopeOf(ctx)` 分层（`PolicyProcesses` 就是拿 agent 的 scope 记账的），一份实例够用；
// 真正按 agent 一份的是执行器那一行（`ToolExecutorPtc`，它决定这个 agent 的模型面）。
import NodePtcRuntimeService from "@deepseek-ai/dsh-ptc-runtime-node";
import { FileSystem } from "@morlay/dsh-fs";
import { Sandbox, SandboxPolicy } from "@morlay/dsh-sandbox";
import { Subprocess } from "@morlay/dsh-shell";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { PtcRuntime } from "./contract/ptc-runtime.contract.ts";

@Injectable()
export class PtcRuntimeDefault extends fromCordis(PtcRuntime, NodePtcRuntimeService) {
  fs = inject(FileSystem);

  subprocess = inject(Subprocess);

  sandbox = inject(Sandbox);

  sandboxPolicy = inject(SandboxPolicy);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      fs: this.fs,
      subprocess: this.subprocess,
      sandbox: this.sandbox,
      sandboxPolicy: this.sandboxPolicy,
    });
  }
}
