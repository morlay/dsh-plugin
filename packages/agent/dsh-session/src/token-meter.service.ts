import { SessionProjections } from "./session-projection.contract.ts";
import TokenMeterService from "@deepseek-ai/dsh-token-meter";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { TokenMeter } from "./token-meter.contract.ts";

@Injectable()
export class TokenMeterDefault extends fromCordis(TokenMeter, TokenMeterService) {
  sessionProjections = inject(SessionProjections);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, { sessionProjections: this.sessionProjections });
  }
}
