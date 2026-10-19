// 设置面板的一行（上游 `ui-settings` / `ui-settings-general` / `ui-settings-models`）。
import * as UiSettingsGeneralPlugin from "@deepseek-ai/dsh-client-ui-settings-general/client";
import { TYPERT_REMOTE as SETTINGS_REMOTE } from "@deepseek-ai/dsh-api-settings-controller/remote";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import {
  ConfigForms,
  Connection,
  Locale,
  Remote,
  RemoteAccess,
  Shortcuts,
  Slots,
} from "@morlay/zephyr-app/client";

@Injectable()
export class SettingsGeneralSlots extends fromCordis(UiSettingsGeneralPlugin) {
  private readonly slots = inject(Slots);

  private readonly locale = inject(Locale);

  private readonly connection = inject(Connection);

  private readonly remote = inject(Remote);

  private readonly configForms = inject(ConfigForms);

  private readonly shortcuts = inject(Shortcuts);

  private readonly remoteAccess = inject(RemoteAccess);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.remote.$mount(SETTINGS_REMOTE);
    await this.mount(ctx, undefined, {
      slots: this.slots,
      locale: this.locale,
      connection: this.connection,
      remote: this.remote,
      "remote.settings": this.remote,
      configForms: this.configForms,
      shortcuts: this.shortcuts,
      modules: MODULES_PLACEHOLDER,
      remoteAccess: this.remoteAccess,
    });
  }
}

/**
 * `ctx.modules` 的占位面。
 *
 * 上游 `ui-settings-general`（设置面板的壳：`sidebar.settings` + 分节导航）会读
 * `ctx.modules.entries`（client 模块系统，用来提示"宿主版本变了，重载页面"）。那套东西来自 kernel 的
 * Loader（`loader.internal`），本仓的 vite 装配没有它 —— 给一个空面：设置面板可用，
 * 「宿主版本变化提示」这一项降级。
 */
const MODULES_PLACEHOLDER = {
  entries: {
    dismissRelease: (): void => {},
    releaseChange: { getSnapshot: (): undefined => undefined, subscribe: (): (() => void) => () => {} },
  },
};
