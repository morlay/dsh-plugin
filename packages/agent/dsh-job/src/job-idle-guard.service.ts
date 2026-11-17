// 「job 域忙不忙」：有任一后台任务还没收尾就是忙。
//
// 那些任务的输出管道挂在被换掉的行上：换树之后它们还在写，读的人拿到的却是新树里的另一个注册表。
// 判据用 `finishedAt`——它缺失就是还活着（上游的列表本身就按这个字段表达生命周期）。
import { Injectable, inject } from "@morlay/zephyr";
import { IdleGuard } from "@morlay/zephyr-app";
import { JobRegistry } from "./contract/job-registry.contract.ts";

@Injectable({ multi: true })
export class JobIdleGuard extends IdleGuard {
  private readonly jobs = inject(JobRegistry);

  /**
   * @returns 所有任务都收了尾就是空闲。
   */
  isIdle(): boolean {
    return this.jobs.list().every((job) => job.finishedAt !== undefined);
  }
}
