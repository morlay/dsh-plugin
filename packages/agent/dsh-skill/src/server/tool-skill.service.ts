// ToolSkill（工具/策略实现行）。
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as ToolSkillPlugin from "@deepseek-ai/dsh-tool-skill";
import { AgentDirectory } from "@morlay/dsh-agent";
import { Skill } from "../contract/skill.contract.ts";
import { ToolRegistry } from "@morlay/dsh-agent";
import { WorkingDirectory } from "@morlay/dsh-working-directory";

@Injectable()
export class ToolSkill extends fromCordis(ToolSkillPlugin) {
  agents = inject(AgentDirectory);

  tools = inject(ToolRegistry);

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
