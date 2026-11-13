// 设置面板的服务层（上游 `ui-settings`）：本行只声明 `configForms` 契约；apply 顺手 `provide` 的
// `settingsSchema` 由 mount 按它自己的注册名发布（同名令牌 `SettingsSchema` 与它指向同一份实例）。
import * as UiSettingsPlugin from "@deepseek-ai/dsh-client-ui-settings/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { ConfigForms, Remote } from "@morlay/zephyr-app/client";
import { SETTINGS_REMOTE } from "@morlay/dsh-setting/endpoint";
import { SETTINGS_REMOTE_KEY } from "@morlay/dsh-setting/endpoint";

@Injectable()
export class SettingsHost extends fromCordis(ConfigForms, UiSettingsPlugin) {
  private readonly remote = inject(Remote);

  override async onInit(ctx: Context): Promise<void> {
    // **失败点前移**：挂不上远端就整行走不完 apply，`ConfigForms` 不会注册，症状最后表现为
    // 「没有提供者：ConfigForms」——离真正的原因很远。这里带上下文抛，指向端点而不是令牌。
    try {
      await this.remote.$mount(SETTINGS_REMOTE);
    } catch (error) {
      throw new Error(`设置远端 ${SETTINGS_REMOTE.package} 挂载失败`, { cause: error });
    }
    await this.mount(ctx, undefined, {
      remote: this.remote,
      [SETTINGS_REMOTE_KEY]: this.remote,
    });
  }
}
