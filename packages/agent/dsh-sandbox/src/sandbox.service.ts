// 沙箱提供者：上游 `LocalSandboxProvider` 经 `fromCordis` 接管。
import LocalSandboxProvider from "@deepseek-ai/dsh-sandbox-local";
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Sandbox } from "./contract/sandbox.contract.ts";

@Injectable()
export class SandboxDefault extends fromCordis(Sandbox, LocalSandboxProvider) {
  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
