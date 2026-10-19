// 子进程运行时：上游 `LocalSubprocessRuntime` 经 `fromCordis` 接管。
import LocalSubprocessRuntime from "@deepseek-ai/dsh-subprocess-local";
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Subprocess } from "./contract/subprocess.contract.ts";

@Injectable()
export class SubprocessDefault extends fromCordis(Subprocess, LocalSubprocessRuntime) {
  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
