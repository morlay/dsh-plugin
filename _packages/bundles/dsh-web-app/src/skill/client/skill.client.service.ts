import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as UiSkillPlugin from "@deepseek-ai/dsh-client-ui-skill";

@Injectable()
export class UiSkill extends fromCordis(UiSkillPlugin) {
  protected override readonly nativeProvide = true;


  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
