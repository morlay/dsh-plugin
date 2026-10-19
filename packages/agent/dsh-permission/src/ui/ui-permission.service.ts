// 权限的浏览器半：上游 `ui-permission-presets` 的 **client 行**。
//
// 入口必须是 `./client`：包根的 `index.ts` 是 node 半（空 `apply`），装它不会注册任何东西
// （输入区的档位选择器与设置里的默认档位行都来自 client 行的 `apply`）。
import * as UiPermissionPlugin from "@deepseek-ai/dsh-client-ui-permission-presets/client";
import { TYPERT_REMOTE as SETTINGS_REMOTE } from "@deepseek-ai/dsh-api-settings-controller/remote";
import { TYPERT_REMOTE as PERMISSION_PRESETS_REMOTE } from "@deepseek-ai/dsh-permission-presets/remote";
import { SessionController } from "@morlay/dsh-session/ui";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import {
  ConfigForms,
  Connection,
  Locale,
  Remote,
  SettingsSchema,
  Slots,
} from "@morlay/zephyr-app/client";

/**
 * `commandUi` 的空面：上游 client 行用它把 `/permission` 挂成输入区的弹层装饰。
 * 本装配的输入区弹层是 `dsh-command` 自己的实现，没有这个服务；装饰降级成空操作，
 * 命令本身仍走宿主的 `/permission`（选择器提交的就是这一行），行为不受影响。
 */
const COMMAND_UI_SHIM = {
  decorate: (): (() => void) => () => {},
  dismiss: (): void => {},
};

@Injectable()
export class UiPermission extends fromCordis(UiPermissionPlugin) {
  private readonly remote = inject(Remote);

  private readonly connection = inject(Connection);

  private readonly sessions = inject(SessionController);

  private readonly slots = inject(Slots);

  private readonly locale = inject(Locale);

  private readonly configForms = inject(ConfigForms);

  private readonly settingsSchema = inject(SettingsSchema);

  protected override async onInit(ctx: Context): Promise<void> {
    // 权限面板读 `remote.permissionPresets`（预设目录）与 `remote.settings`（默认档位的读写）。
    await this.remote.$mount(PERMISSION_PRESETS_REMOTE);
    await this.remote.$mount(SETTINGS_REMOTE);
    // 上游 client 行声明了这些依赖（含两个点号名）：`fromCordis` 的适配行按 dep 名逐条校验并放进行作用域。
    await this.mount(ctx, undefined, {
      commandUi: COMMAND_UI_SHIM,
      connection: this.connection,
      sessions: this.sessions,
      slots: this.slots,
      locale: this.locale,
      remote: this.remote,
      "remote.permissionPresets": this.remote,
      "remote.settings": this.remote,
      configForms: this.configForms,
      settingsSchema: this.settingsSchema,
    });
  }
}
