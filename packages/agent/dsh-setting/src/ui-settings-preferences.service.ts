// 共享的「开发者工具」偏好（上游 `ui-settings` 的 **host 半**，`@deepseek-ai/dsh-client-ui-settings` 的包根）。
//
// 它注册 `ui-settings` 这个设置命名空间（默认 `enabled: true`）。没有它：
// - `settings/describe` 里没有 `ui-settings`，`configForms.developerTools.enabled` 落回 `false`；
// - `ui-conversation` 的视图列表会把 `trajectory` 过滤掉（`!developerTools.enabled && id === 'trajectory'`），
//   主区就只剩「对话」、没有「轨迹」。
import * as UiSettingsPlugin from "@deepseek-ai/dsh-client-ui-settings";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { SettingSchema } from "./setting-schema.service.ts";

@Injectable()
export class UiSettingsPreferences extends fromCordis(UiSettingsPlugin) {
  private readonly schemas = inject(SettingSchema);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
    // **命名空间要显式登记**：本装配的 `settings/describe` 按 `SettingSchema` 的注册表列 namespace
    // （没有上游那套靠 cordis loader 自动收集的机制）。少了这一行，`ui-settings` 不出现在设置里，
    // 客户端的 `configForms.developerTools.enabled` 落回 `false`，轨迹视图就被过滤掉。
    this.schemas.register("ui-settings", UiSettingsPlugin.Config.toJSON());
  }
}
