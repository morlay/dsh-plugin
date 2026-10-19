import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import * as UiLayoutPlugin from "@deepseek-ai/dsh-client-ui-layout";

@Injectable()
export class UiLayout extends fromCordis(UiLayoutPlugin) {
  protected override readonly nativeProvide = true;


  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
