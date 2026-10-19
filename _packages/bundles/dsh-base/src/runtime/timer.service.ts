// 定时器：上游 `TimerService` 经 `fromCordis` 接管。
import { TimerService } from "@deepseek-ai/cordis-plugin-timer";
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Timer } from "./timer.contract.ts";

@Injectable()
export class TimerDefault extends fromCordis(Timer, TimerService) {
  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
