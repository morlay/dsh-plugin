// 默认实现：从行 ctx 的槽位读快照（`launchEnvironmentOf` 是上游的读法）。
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { Injectable, type Context } from "@morlay/zephyr";
import { LaunchEnvironment } from "../contract/launch-environment.contract.ts";

@Injectable()
export class LaunchEnvironmentDefault extends LaunchEnvironment {
  private current: LaunchEnvironment["snapshot"];

  protected onInit(ctx: Context): void {
    this.current = launchEnvironmentOf(ctx);
  }

  get snapshot(): LaunchEnvironment["snapshot"] {
    return this.current;
  }
}
