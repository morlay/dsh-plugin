import { SessionProjections } from "@morlay/dsh-base/session-projection";
import TokenMeterService from "@deepseek-ai/dsh-token-meter";
import { SessionProjectionRegistry } from "@deepseek-ai/dsh-session-projection";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { TokenMeter } from "./contract.ts";

@Injectable()
export class TokenMeterDefault extends fromCordis(TokenMeter, TokenMeterService) {
  sessionProjections = inject(SessionProjections);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, { sessionProjections: this.sessionProjections });
  }
}
