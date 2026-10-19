// ToolWorkingDirectory（工具/策略实现行）。
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as ToolWorkingDirectoryPlugin from "@deepseek-ai/dsh-tool-working-directory";
import { Tools } from "@morlay/dsh-agent";
import { WorkingDirectory } from "../working-directory.contract.ts";

@Injectable()
export class ToolWorkingDirectory extends fromCordis(ToolWorkingDirectoryPlugin) {
  tools = inject(Tools);

  workingDirectory = inject(WorkingDirectory);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, { tools: this.tools, workingDirectory: this.workingDirectory });
  }
}
