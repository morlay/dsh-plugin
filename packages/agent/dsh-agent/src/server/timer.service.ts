// 定时器：上游 `TimerService` 经 `fromCordis` 接管，令牌就是上游那个服务类本身。
//
// 不另立本地契约：上游 `TimerService` 的成员面（`timeout` / `interval` / `throttle` / `debounce`）
// 就是消费方要的全部，本地空抽象类只会多一层「0 成员 0 消费」的假想接缝。
import { TimerService } from "@deepseek-ai/cordis-plugin-timer";
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";

@Injectable()
export class TimerDefault extends fromCordis(TimerService, TimerService) {
  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
