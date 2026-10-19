import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as UiSidebarPlugin from "@deepseek-ai/dsh-client-ui-sidebar";
import * as UiSidebarRightPlugin from "@deepseek-ai/dsh-client-ui-sidebar-right";
import * as UiSidebarDocumentpreviewPlugin from "@deepseek-ai/dsh-client-ui-sidebar-documentpreview";
import * as UiSidebarBrowserPlugin from "@deepseek-ai/dsh-client-ui-sidebar-browser";
import * as UiSidebarTerminalPlugin from "@deepseek-ai/dsh-client-ui-sidebar-terminal";
import * as UiSidebarFilesPlugin from "@deepseek-ai/dsh-client-ui-sidebar-files";

@Injectable()
export class UiSidebar extends fromCordis(UiSidebarPlugin) {
  protected override readonly nativeProvide = true;


  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}

@Injectable()
export class UiSidebarRight extends fromCordis(UiSidebarRightPlugin) {

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}

@Injectable()
export class UiSidebarDocumentpreview extends fromCordis(UiSidebarDocumentpreviewPlugin) {

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}

@Injectable()
export class UiSidebarBrowser extends fromCordis(UiSidebarBrowserPlugin) {

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}

@Injectable()
export class UiSidebarTerminal extends fromCordis(UiSidebarTerminalPlugin) {

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}

@Injectable()
export class UiSidebarFiles extends fromCordis(UiSidebarFilesPlugin) {

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
