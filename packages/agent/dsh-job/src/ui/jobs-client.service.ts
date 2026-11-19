// `ctx.jobs` 的实现（浏览器侧）：上游 `dsh-api-job-controller/client` 的 `apply` 经 `fromCordis` 照装。
//
// 上游那一行只做一件事——`new ClientJobs(ctx, { $stream, job }, model)`：把 `job` 那组 remote 的
// roster / follow / kill 拼成**引用计数**的流（同一会话两个看客共用一条 roster 流，最后一个看客走时收回）。
// 组件不碰传输，只读 `state`。
//
// **`job` 那组 remote 要自己 `$mount`**：浏览器里没有全局的 remotes 装载，每个域挂自己那份
// `TYPERT_REMOTE`（同 `dsh-agent-team` 的 `agentTeams`、`dsh-workspace` 的工作区文件组）。上游 `apply` 里
// `const { job } = remote` 是**属性读**，挂上之前读到的是空——症状是「头部有入口，点开永远是空列表」。
import * as ClientJobsPlugin from "@deepseek-ai/dsh-api-job-controller/client";
import { TYPERT_REMOTE as JOB_REMOTE } from "@deepseek-ai/dsh-api-job-controller/remote";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Remote } from "@morlay/zephyr-app/client";
import { Jobs } from "./jobs.contract.ts";

/** 后台任务的数据面（浏览器半）。 */
@Injectable()
export class JobsClient extends fromCordis(Jobs, ClientJobsPlugin) {
  private readonly remote = inject(Remote);

  override async onInit(ctx: Context): Promise<void> {
    const dispose = await this.remote.$mount(JOB_REMOTE);
    ctx.effect(() => dispose);
    await this.mount(ctx, undefined, { remote: this.remote });
  }
}
