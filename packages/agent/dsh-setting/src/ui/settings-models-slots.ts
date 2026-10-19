// 设置面板的一行（上游 `ui-settings` / `ui-settings-general` / `ui-settings-models`）。
import * as UiSettingsModelsPlugin from "@deepseek-ai/dsh-client-ui-settings-models/client";
import { TYPERT_REMOTE as SETTINGS_REMOTE } from "@deepseek-ai/dsh-api-settings-controller/remote";
import { TYPERT_REMOTE as LLM_REMOTE } from "@deepseek-ai/dsh-llm/remote";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { ConfigForms, Locale, Remote, Slots } from "@morlay/zephyr-app/client";
import { SettingsSchema } from "./ui-settings.token.ts";

@Injectable()
export class SettingsModelsSlots extends fromCordis(UiSettingsModelsPlugin) {
  private readonly slots = inject(Slots);

  private readonly locale = inject(Locale);

  private readonly remote = inject(Remote);

  private readonly configForms = inject(ConfigForms);

  private readonly settingsSchema = inject(SettingsSchema);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.remote.$mount(SETTINGS_REMOTE);
    await this.remote.$mount(LLM_REMOTE);
    await this.mount(ctx, undefined, {
      slots: this.slots,
      locale: this.locale,
      remote: this.remote,
      "remote.credentials": this.remote,
      "remote.llm": this.remote,
      "remote.settings": this.remote,
      "remote.session": this.remote,
      configForms: this.configForms,
      settingsSchema: this.settingsSchema,
    });
  }
}
