// 设置 schema 服务（上游 `ui-settings` 的 apply 里 `ctx.reflect.provide('settingsSchema', …)`）。
//
// 消费方是 `ui-settings-models`：`createSettingsSchemaOperations(ctx.settingsSchema)` 之后按命名空间
// 读字段描述。它同样是跨行共享注册表，令牌带上游注册名，按名字与按令牌是同一份实例。
import { InjectionToken } from "@morlay/zephyr";

/** `ctx.settingsSchema`：按命名空间取字段描述（`ui-settings-models` 的 schema operations 面）。 */
export const SettingsSchema = new InjectionToken<unknown>("settingsSchema");
