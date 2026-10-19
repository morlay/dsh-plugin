import { Subprocess } from "@morlay/dsh-base/sandbox";
import { Connection } from "@morlay/dsh-base/connection";
import { WebServer } from "@morlay/dsh-base/web-server";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as OpenInAppPlugin from "@deepseek-ai/dsh-host-open-in-app";
import * as DirectoryPickerPlugin from "@deepseek-ai/dsh-host-directory-picker-auto";

@Injectable()
export class OpenInApp extends fromCordis(OpenInAppPlugin) {
  webServer = inject(WebServer);

  connection = inject(Connection);

  subprocess = inject(Subprocess);

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, {
      webServer: this.webServer,
      connection: this.connection,
      subprocess: this.subprocess,
      probeTimeoutMs: 10000,
      iconTimeoutMs: 10000,
      launchWatchMs: 1000,
    });
  }
}

@Injectable()
export class DirectoryPicker extends fromCordis(DirectoryPickerPlugin) {

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
