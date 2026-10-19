// 后台任务注册表：上游 `LocalJobRegistry` 经 `fromCordis` 接管。
import { LocalJobRegistry } from "@deepseek-ai/dsh-jobs-local";
import { Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { JobRegistry } from "./contract/job-registry.contract.ts";

@Injectable()
export class JobRegistryDefault extends fromCordis(JobRegistry, LocalJobRegistry) {
  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}
