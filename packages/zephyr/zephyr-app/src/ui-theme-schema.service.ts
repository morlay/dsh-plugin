// `ui-theme` 命名空间的**配置 schema**（上游 `ThemeSettingsSchema`，durable 的那一份）。
//
// 上游把它挂在 profile 的主题插件条目上（主题插件的 `Config` schema 由 loader 投影成 settings 视图）；
// 本装配没有 profile，主题只装了浏览器半（`provideTheme`），所以 durable schema 由这一行注册。
//
// 不抄字段：默认值（`preference: "system"`、三项字号、三项字体 `''`）只有一个 home —— 上游 schema。
// 视图的 `value` 就是从它算出来的默认层；缺了它，浏览器里 `normalizeFontFamily(undefined)` 会崩。
import {
  THEME_SETTINGS_NAMESPACE,
  ThemeSettingsSchema,
} from "@deepseek-ai/dsh-client-ui-theme/src/theme-settings.ts";
import { inject, Injectable, type OnInit } from "@morlay/zephyr";
import { SettingSchema } from "./setting-schema.service.ts";

@Injectable()
export class UiThemeSchema implements OnInit {
  private readonly schemas = inject(SettingSchema);

  onInit(): void {
    this.schemas.register(THEME_SETTINGS_NAMESPACE, ThemeSettingsSchema.toJSON());
  }
}
