// 设置相关的跨行服务令牌：`settingsSchema`（`ui-settings` 行提供）。
//
// 这里只做**再导出**：令牌的 home 在 `@morlay/zephyr-app/client`（谁定义谁给面），本域不另立一份。
// 曾经的 `CommandUi = new InjectionToken<unknown>("commandUi")` 已删：命令 UI 的真契约在
// `@morlay/dsh-command/ui`（`CommandUi` 抽象类，实现是上游 `ui-commands` 那一行），这里那份是
// 同名不同身份的第二个令牌，且零消费者——两份令牌 = 两次注册，注入端拿到的会是空。

/** `ctx.settingsSchema`（设置 schema 服务：按命名空间取字段描述）。 */
export { SettingsSchema } from "@morlay/zephyr-app/client";
