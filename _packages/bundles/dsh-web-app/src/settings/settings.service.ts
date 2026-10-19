// 设置表单的宿主（`@deepseek-ai/dsh-settings`）：把各 namespace 的 schema 投成表单。
import SettingsPlugin from "@deepseek-ai/dsh-settings";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { ConfigEditor } from "./config-editor.service.ts";
import { ProfileContextToken } from "./profile-context.ts";

@Injectable()
export class Settings extends fromCordis(SettingsPlugin) {
  configEditor = inject(ConfigEditor);

  profile = inject(ProfileContextToken);

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, { configEditor: this.configEditor, profileContext: this.profile });
  }
}
