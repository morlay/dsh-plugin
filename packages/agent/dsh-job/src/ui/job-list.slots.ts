// 会话头部的「后台任务」入口：上游 `dsh-client-ui-jobs/client` 的 `apply` 经 `fromCordis` 照装。
//
// 它注册两件东西：`job` 那份字典，以及 `conversation.session.header.actions` 下 `id: 'job-list'` 的一格
// ——本会话的 job 行（状态、耗时、进度）、展开后的实时输出面板（`job.follow` 那条流）、以及两次点击的
// 人工 kill。**不重写组件**：上游那份照用，它的 `inject` 面（`hooks.jobs` / `watchRows` / `observe` /
// `killJob`）由渲染器按声明绑成 `useJobs`。
//
// 它按名字读 `jobs` / `slots` / `locale`，所以装配上必须排在 `JobsClient` 之后——`inject(Jobs)` 就是这条边。
import * as ClientUiJobs from "@deepseek-ai/dsh-client-ui-jobs/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Locale, Slots } from "@morlay/zephyr-app/client";
import { Jobs } from "./jobs.contract.ts";

/** 会话头部的后台任务列表（浏览器半）。 */
@Injectable()
export class JobListSlots extends fromCordis(ClientUiJobs) {
  private readonly slots = inject(Slots);

  private readonly locale = inject(Locale);

  private readonly jobs = inject(Jobs);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      slots: this.slots,
      locale: this.locale,
      jobs: this.jobs,
    });
  }
}
