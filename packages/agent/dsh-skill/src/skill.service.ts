import SkillRegistry from "@deepseek-ai/dsh-skill";
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Skill } from "./contract/skill.contract.ts";
import { AgentScoped } from "@morlay/dsh-agent-contract";

@AgentScoped()
@Injectable()
export class SkillDefault extends fromCordis(Skill, SkillRegistry) {
  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
