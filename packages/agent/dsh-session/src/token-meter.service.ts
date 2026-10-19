import { SessionProjectionStore } from "./contract/session-projection-store.contract.ts";
import TokenMeterService from "@deepseek-ai/dsh-token-meter";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { TokenMeter } from "./contract/token-meter.contract.ts";

@Injectable()
export class TokenMeterDefault extends fromCordis(TokenMeter, TokenMeterService) {
  sessionProjections = inject(SessionProjectionStore);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, { sessionProjections: this.sessionProjections });
  }
}
