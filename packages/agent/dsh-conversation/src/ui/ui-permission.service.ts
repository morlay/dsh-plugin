// 权限的浏览器半：上游 `ui-permission-presets` 的 **client 行**。
//
// 入口必须是 `./client`：包根的 `index.ts` 是 node 半（空 `apply`），装它不会注册任何东西
// （输入区的档位选择器与设置里的默认档位行都来自 client 行的 `apply`）。
import * as UiPermissionPlugin from "@deepseek-ai/dsh-client-ui-permission-presets/client";
import { CommandUi } from "@morlay/dsh-command/ui";
import { SessionController } from "@morlay/dsh-conversation/ui";
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
import { SETTINGS_REMOTE } from "@morlay/dsh-setting/endpoint";
// 远端身份只从 `./endpoint`（client-safe）取：包根带三个宿主 service，浏览器半引不得。
import { PERMISSION_PRESETS_REMOTE } from "@morlay/dsh-permission/endpoint";
import { SETTINGS_REMOTE_KEY } from "@morlay/dsh-setting/endpoint";

@Injectable()
export class UiPermission extends fromCordis(UiPermissionPlugin) {
  private readonly remote = inject(Remote);

  private readonly connection = inject(Connection);

  private readonly sessions = inject(SessionController);

  private readonly slots = inject(Slots);

  private readonly locale = inject(Locale);

  private readonly configForms = inject(ConfigForms);

  private readonly settingsSchema = inject(SettingsSchema);

  /** 上游这一行把 `/permission` 的弹层装饰挂到命令 UI 上（`/` 面板里因此有这一条）。 */
  private readonly commandUi = inject(CommandUi);

  override async onInit(ctx: Context): Promise<void> {
    // 权限面板读 「权限预设组」（预设目录）与 「设置组」（默认档位的读写）。
    await this.remote.$mount(PERMISSION_PRESETS_REMOTE);
    await this.remote.$mount(SETTINGS_REMOTE);
    // `remote` 交给上游时**摊平成普通对象**：`Remote` 的命名空间是 Proxy 回落出来的动态属性，
    // 而 cordis 服务名视图给的是包装层，上面读不到这些属性（实测 `ctx.remote.permissionPresets`
    // 是 undefined，报错点漂成 `reading 'catalog'`）。这里把两条 face 与四个方法显式给出。
    const remote = this.remote;
    const namespaces = remote as unknown as Record<string, unknown>;
    // `Remote` 契约本身不列 namespace（见 `remote.contract.ts`），这里按名字取两条 face。
    const remoteForUi = {
      permissionPresets: namespaces["permissionPresets"],
      settings: namespaces["settings"],
      $on: (channel: string, listener: (...args: never[]) => unknown): (() => void) =>
        remote.$on(channel, listener),
      $mount: (contribution: unknown): Promise<() => Promise<void>> => remote.$mount(contribution),
      $stream: (options: Parameters<typeof remote.$stream>[0]): unknown => remote.$stream(options),
      whenMounted: (): Promise<void> => remote.whenMounted(),
      whenNamespace: (namespace: string): Promise<void> => remote.whenNamespace(namespace),
    };
    // 上游 client 行声明了这些依赖（含两个点号名）：`fromCordis` 的适配行按 dep 名逐条校验并放进行作用域。
    await this.mount(ctx, undefined, {
      commandUi: this.commandUi,
      connection: this.connection,
      sessions: this.sessions,
      slots: this.slots,
      locale: this.locale,
      remote: remoteForUi,
      "remote.permissionPresets": remoteForUi.permissionPresets,
      [SETTINGS_REMOTE_KEY]: remoteForUi.settings,
      configForms: this.configForms,
      settingsSchema: this.settingsSchema,
    });
  }
}
