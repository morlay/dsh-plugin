// ToolSkill（工具/策略实现行）。
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as ToolSkillPlugin from "@deepseek-ai/dsh-tool-skill";
import { Agents } from "@morlay/dsh-agent"
import { Skill } from "@morlay/dsh-context";
import { Tools } from "@morlay/dsh-agent";
import { WorkingDirectory } from "@morlay/dsh-env";

@Injectable()
export class ToolSkill extends fromCordis(ToolSkillPlugin) {
  agents = inject(Agents);

  tools = inject(Tools);

  skills = inject(Skill);

  workingDirectory = inject(WorkingDirectory);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      agents: this.agents,
      tools: this.tools,
      skills: this.skills,
      workingDirectory: this.workingDirectory,
    });
  }
}
