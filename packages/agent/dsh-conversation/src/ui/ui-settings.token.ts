// 设置与权限相关的跨行服务令牌：`settingsSchema`（`ui-settings` 行提供）。
import { InjectionToken } from "@morlay/zephyr";

/** `ctx.settingsSchema`（设置 schema 服务：按命名空间取字段描述）。 */
export { SettingsSchema } from "@morlay/zephyr-app/client";

/** `ctx.commandUi`（命令 UI 注册表：`ui-model-selection` / `ui-permission-presets` 往输入区挂命令）。 */
export const CommandUi = new InjectionToken<unknown>("commandUi");
