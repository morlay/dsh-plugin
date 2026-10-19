// OpenTelemetry 聚合面：上游 `OTelService` 经 `fromCordis` 接管。
import OTelService from "@deepseek-ai/dsh-otel";
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Otel } from "./contract/otel.contract.ts";

@Injectable()
export class OtelDefault extends fromCordis(Otel, OTelService) {
  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
