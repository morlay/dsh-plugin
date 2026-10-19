// 上游 `JobController` 的适配行：只负责把它装起来并把依赖交进去（`static inject = ['jobs','typert']`）。
//
// 为什么单独一行、而不是让 `JobEndpointDefault` 直接 `fromCordis`：契约类的组名与方法元数据要走
// **类的原型链**（`registerRemoteGroup` 沿链收集），所以宿主实现必须 `extends JobEndpoint`；
// 而 `fromCordis(...)` 也是继承。两者不能同时继承，于是拆成「适配行（提供上游实例）」+
// 「端点行（继承契约、注入适配行）」，元数据仍然只有契约一个 home。
import JobController from "@deepseek-ai/dsh-api-job-controller";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Typert } from "@morlay/zephyr-app";
import { JobRegistry } from "./contract/job-registry.contract.ts";

/** `job` 命名空间的上游宿主服务（`api/job-controller`）。 */
@Injectable()
export class JobControllerRow extends fromCordis(JobController) {
  private readonly jobs = inject(JobRegistry);

  private readonly typert = inject(Typert);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, { jobs: this.jobs, typert: this.typert });
  }
}
