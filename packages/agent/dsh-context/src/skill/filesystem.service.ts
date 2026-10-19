import { Skill } from "@morlay/dsh-context";
import * as SkillFilesystemPlugin from "@deepseek-ai/dsh-skill-filesystem";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";

@Injectable()
export class SkillFilesystem extends fromCordis(SkillFilesystemPlugin) {
  skills = inject(Skill);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, { skills: this.skills });
  }
}
