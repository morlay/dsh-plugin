// PTC 运行时：上游 `NodePtcRuntimeService` 经 `fromCordis` 接管。
//
// 声明了 `@AgentScoped()`：一台运行时**按 agent 一份**（程序在会话自己的 scope 里跑，工作目录、沙箱、
// 文件系统都是该 agent 的那一套），由 per-agent 装配器装进每个 agent 的 `agentCtx`。
import NodePtcRuntimeService from "@deepseek-ai/dsh-ptc-runtime-node";
import { FileSystem } from "@morlay/dsh-fs";
import { Sandbox, SandboxPolicy } from "@morlay/dsh-sandbox";
import { Subprocess } from "@morlay/dsh-shell";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { PtcRuntime } from "./contract/ptc-runtime.contract.ts";
import { AgentScoped } from "@morlay/dsh-agent";

@AgentScoped()
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
