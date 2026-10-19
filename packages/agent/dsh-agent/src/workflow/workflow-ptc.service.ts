// PTC workflow 引擎：上游 `PtcWorkflowEngine` 经 `fromCordis` 接管。
import PtcWorkflowEngine from "@deepseek-ai/dsh-workflow-ptc";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { PtcRuntime } from "@morlay/dsh-env";
import { SandboxPolicy, WorkingDirectory } from "@morlay/dsh-env";
import { Subagents } from "@morlay/dsh-agent/subagent";
import { WorkflowEngine } from "./workflow-engine.contract.ts";

@Injectable()
export class WorkflowPtc extends fromCordis(WorkflowEngine, PtcWorkflowEngine) {
  subagents = inject(Subagents);

  ptcRuntime = inject(PtcRuntime);

  sandboxPolicy = inject(SandboxPolicy);

  workingDirectory = inject(WorkingDirectory);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      subagents: this.subagents,
      ptcRuntime: this.ptcRuntime,
      sandboxPolicy: this.sandboxPolicy,
      workingDirectory: this.workingDirectory,
    });
  }
}
