import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as UiSettingsAccountPlugin from "@deepseek-ai/dsh-client-ui-settings-account";
import * as UiSettingsPlugin from "@deepseek-ai/dsh-client-ui-settings";
import * as UiSettingsGeneralPlugin from "@deepseek-ai/dsh-client-ui-settings-general";
import * as UiSettingsModelsPlugin from "@deepseek-ai/dsh-client-ui-settings-models";
import * as UiSettingsPluginInventoryPlugin from "@deepseek-ai/dsh-client-ui-settings-plugin-inventory";
import * as UiSettingsSessionLogPlugin from "@deepseek-ai/dsh-client-ui-settings-session-log";
import * as UiSettingsPluginsPlugin from "@deepseek-ai/dsh-client-ui-settings-plugins";
import * as UiSettingsShellPlugin from "@deepseek-ai/dsh-client-ui-settings-shell";
import * as UiSettingsAgentLoopPlugin from "@deepseek-ai/dsh-client-ui-settings-agent-loop";
import * as UiSettingsSubagentPlugin from "@deepseek-ai/dsh-client-ui-settings-subagent";
import * as UiSettingsWebSearchPlugin from "@deepseek-ai/dsh-client-ui-settings-web-search";

@Injectable()
export class UiSettingsAccount extends fromCordis(UiSettingsAccountPlugin) {
  protected override readonly nativeProvide = true;


  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}

@Injectable()
export class UiSettings extends fromCordis(UiSettingsPlugin) {

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}

@Injectable()
export class UiSettingsGeneral extends fromCordis(UiSettingsGeneralPlugin) {

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}

@Injectable()
export class UiSettingsModels extends fromCordis(UiSettingsModelsPlugin) {

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}

@Injectable()
export class UiSettingsPluginInventory extends fromCordis(UiSettingsPluginInventoryPlugin) {

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}

@Injectable()
export class UiSettingsSessionLog extends fromCordis(UiSettingsSessionLogPlugin) {

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}

@Injectable()
export class UiSettingsPlugins extends fromCordis(UiSettingsPluginsPlugin) {

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}

@Injectable()
export class UiSettingsShell extends fromCordis(UiSettingsShellPlugin) {

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}

@Injectable()
export class UiSettingsAgentLoop extends fromCordis(UiSettingsAgentLoopPlugin) {

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}

@Injectable()
export class UiSettingsSubagent extends fromCordis(UiSettingsSubagentPlugin) {

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}

@Injectable()
export class UiSettingsWebSearch extends fromCordis(UiSettingsWebSearchPlugin) {

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
