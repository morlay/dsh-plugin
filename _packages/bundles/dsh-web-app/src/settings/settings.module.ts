// 上游设置链（**原样保留**）：上游插件用它们自己的 `settings` + `config-editor`（一份 profile patch）。
// 我们自己的包另走 `PackageConfig`（`settings/<package>/config.json`），两者不在同一个服务名上。
import SettingsController from "@deepseek-ai/dsh-api-settings-controller";
import ConfigEditorPlugin from "@deepseek-ai/dsh-config-editor";
import SettingsPlugin from "@deepseek-ai/dsh-settings";
import { Module } from "@morlay/zephyr";
import { LoaderMock } from "./loader.mock.ts";
import { PackageConfig } from "./package-config.service.ts";
import { ProfileContextService } from "./profile-context.service.ts";

@Module({
  providers: [
    LoaderMock,
    ProfileContextService,
    PackageConfig,
    ConfigEditorPlugin,
    SettingsPlugin,
    SettingsController,
  ],
})
export class SettingsFormsModule {}
