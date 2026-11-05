// 设置面板的一行（上游 `ui-settings` / `ui-settings-general` / `ui-settings-models`）。
import * as UiSettingsModelsPlugin from "@deepseek-ai/dsh-client-ui-settings-models/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { ConfigForms, Locale, Remote, Slots } from "@morlay/zephyr-app/client";
import { SettingsSchema } from "./ui-settings.token.ts";
import { LLM_REMOTE } from "@morlay/dsh-agent/endpoint";
import { SETTINGS_REMOTE } from "@morlay/dsh-setting/endpoint";
import { CREDENTIALS_REMOTE_KEY } from "@morlay/dsh-auth/endpoint";
import { LLM_REMOTE_KEY } from "@morlay/dsh-agent/endpoint";
import { SESSION_REMOTE_KEY } from "@morlay/dsh-session/endpoint";
import { SETTINGS_REMOTE_KEY } from "@morlay/dsh-setting/endpoint";

@Injectable()
export class SettingsModelsSlots extends fromCordis(UiSettingsModelsPlugin) {
  private readonly slots = inject(Slots);

  private readonly locale = inject(Locale);

  private readonly remote = inject(Remote);

  private readonly configForms = inject(ConfigForms);

  private readonly settingsSchema = inject(SettingsSchema);

  override async onInit(ctx: Context): Promise<void> {
    await this.remote.$mount(SETTINGS_REMOTE);
    await this.remote.$mount(LLM_REMOTE);
    await this.mount(ctx, undefined, {
      slots: this.slots,
      locale: this.locale,
      remote: this.remote,
      [CREDENTIALS_REMOTE_KEY]: this.remote,
      [LLM_REMOTE_KEY]: this.remote,
      [SETTINGS_REMOTE_KEY]: this.remote,
      [SESSION_REMOTE_KEY]: this.remote,
      configForms: this.configForms,
      settingsSchema: this.settingsSchema,
    });
  }
}
