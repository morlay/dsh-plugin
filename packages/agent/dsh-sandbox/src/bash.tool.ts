// `bash` 工具行：把 shell 的能力交给上游 `tool-bash`（工具定义在上游，这里只交依赖）。
//
// 住沙箱域：它要 `sandboxPolicy`（判定执行器是否受限）与 shell 的执行器；依赖方向是
// `sandbox → shell` / `sandbox → agent`（工具注册表、系统提示词、工作目录），都是下层往上交依赖。
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as ToolBashPlugin from "@deepseek-ai/dsh-tool-bash";
import { SystemPrompt, ToolRegistry, WorkingDirectory } from "@morlay/dsh-agent";
import { ShellEnv, ShellExecutor } from "@morlay/dsh-shell";
import { SandboxPolicy } from "./contract/index.ts";

@Injectable()
export class ToolBash extends fromCordis(ToolBashPlugin) {
  tools = inject(ToolRegistry);

  shell = inject(ShellExecutor);

  systemPrompt = inject(SystemPrompt);

  shellEnv = inject(ShellEnv);

  workingDirectory = inject(WorkingDirectory);

  // 上游在 apply 里读 `ctx.sandboxPolicy` 判定「执行器是否被约束」：受限时必须显式交进去。
  sandboxPolicy = inject(SandboxPolicy);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      tools: this.tools,
      shell: this.shell,
      systemPrompt: this.systemPrompt,
      shellEnv: this.shellEnv,
      workingDirectory: this.workingDirectory,
      sandboxPolicy: this.sandboxPolicy,
    });
  }
}
