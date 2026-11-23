// 设置面板的一行（上游 `ui-settings` / `ui-settings-general` / `ui-settings-models`）。
import * as UiSettingsModelsPlugin from "@deepseek-ai/dsh-client-ui-settings-models/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { ConfigForms, fixedSyncedConfig, Locale, Remote, Slots } from "@morlay/zephyr-app/client";
import { SettingsSchema } from "./ui-settings.token.ts";
import { LLM_REMOTE } from "@morlay/dsh-agent/endpoint";
import { SETTINGS_REMOTE } from "@morlay/dsh-setting/endpoint";
import { credentialsGroupName } from "@morlay/dsh-auth/endpoint";
import { llmGroupName } from "@morlay/dsh-agent/endpoint";
import { sessionGroupName } from "@morlay/dsh-session/endpoint";
import { remoteNamespaceKey } from "@morlay/zephyr-app/client/remote";
import { settingsGroupName } from "@morlay/dsh-setting/endpoint";

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
    // 上游 0.2.3 起这份 client 的 `Config` 由 Host 同步（`credentialOnboarding`）：没通道时给"未配置"。
    await this.mount(ctx, fixedSyncedConfig(["credentialOnboarding"]), {
      slots: this.slots,
      locale: this.locale,
      remote: this.remote,
      [remoteNamespaceKey(credentialsGroupName())]: this.remote,
      [remoteNamespaceKey(llmGroupName())]: this.remote,
      [remoteNamespaceKey(settingsGroupName())]: this.remote,
      [remoteNamespaceKey(sessionGroupName())]: this.remote,
      configForms: this.configForms,
      settingsSchema: this.settingsSchema,
    });
  }
}
