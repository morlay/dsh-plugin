import { Module } from "@morlay/zephyr";
import { UiSettings, UiSettingsAccount, UiSettingsAgentLoop, UiSettingsGeneral, UiSettingsModels, UiSettingsPluginInventory, UiSettingsPlugins, UiSettingsSessionLog, UiSettingsShell, UiSettingsSubagent, UiSettingsWebSearch } from "./settings.client.service.ts";

@Module({ providers: [UiSettingsAccount, UiSettings, UiSettingsGeneral, UiSettingsModels, UiSettingsPluginInventory, UiSettingsSessionLog, UiSettingsPlugins, UiSettingsShell, UiSettingsAgentLoop, UiSettingsSubagent, UiSettingsWebSearch] })
export class SettingsClientModule {}
