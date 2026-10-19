import JobControllerPlugin from "@deepseek-ai/dsh-api-job-controller";
import { Jobs } from "@morlay/dsh-base/runtime";
import { Typert } from "@morlay/dsh-base/typert";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";

@Injectable()
export class JobController extends fromCordis(JobControllerPlugin) {
  jobs = inject(Jobs);

  typert = inject(Typert);

  protected async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, { jobs: this.jobs, typert: this.typert });
  }
}
