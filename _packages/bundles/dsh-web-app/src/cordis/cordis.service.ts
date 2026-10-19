import { Tools } from "@morlay/dsh-base/tool";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import CordisHostRunnerPlugin from "@deepseek-ai/dsh-cordis-host-runner";
import * as CordisInspectProvidersPlugin from "@deepseek-ai/dsh-tool-cordis/host";
import * as CordisClientRunnerPlugin from "@deepseek-ai/dsh-cordis-client-runner";

@Injectable()
export class CordisHostRunner extends fromCordis(CordisHostRunnerPlugin) {
  tools = inject(Tools);

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, { tools: this.tools });
  }
}

@Injectable()
export class CordisInspectProviders extends fromCordis(CordisInspectProvidersPlugin) {
  cordisInspect = inject(CordisHostRunner);

  tools = inject(Tools);

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, { cordisInspect: this.cordisInspect, tools: this.tools });
  }
}

@Injectable()
export class CordisClientRunner extends fromCordis(CordisClientRunnerPlugin) {

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
