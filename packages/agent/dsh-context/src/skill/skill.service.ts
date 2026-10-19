import SkillRegistry from "@deepseek-ai/dsh-skill";
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Skill } from "../skill.contract.ts";

@Injectable()
export class SkillDefault extends fromCordis(Skill, SkillRegistry) {
  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
