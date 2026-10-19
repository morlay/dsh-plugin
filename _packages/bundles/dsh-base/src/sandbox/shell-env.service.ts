// shell 环境注册表：上游 `ShellEnvRegistry` 经 `fromCordis` 接管。
import { ShellEnvRegistry } from "@deepseek-ai/dsh-shell-env";
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { ShellEnv } from "./shell-env.contract.ts";

@Injectable()
export class ShellEnvDefault extends fromCordis(ShellEnv, ShellEnvRegistry) {
  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
