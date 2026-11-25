// `ctx.jobs` 的实现（浏览器侧）：上游 `dsh-api-job-controller/client` 的 `apply` 经 `fromCordis` 照装。
//
// 上游那一行只做一件事——`new ClientJobs(ctx, { $stream, job }, model)`：把 `job` 那组 remote 的
// roster / follow / kill 拼成**引用计数**的流（同一会话两个看客共用一条 roster 流，最后一个看客走时收回）。
// 组件不碰传输，只读 `state`。
//
// `job` 那组 remote 的挂载不在这里：那是 `JobEndpointClient` 自己的 `onInit`。本行注入它只为**顺序**
// （上游 `apply` 里 `const { job } = remote` 是属性读，挂上之前读到的是空）。
import * as ClientJobsPlugin from "@deepseek-ai/dsh-api-job-controller/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Remote } from "@morlay/zephyr-app/client";
import { Jobs } from "../contract/index.ts";
import { JobEndpointClient } from "./job-endpoint.client.ts";

/** 后台任务的数据面（浏览器半）。 */
@Injectable()
export class JobsClient extends fromCordis(Jobs, ClientJobsPlugin) {
  private readonly remote = inject(Remote);

  /** `job` 那组 descriptor 由它挂上：这条注入就是「挂载先于消费」的排序边。 */
  private readonly endpoint = inject(JobEndpointClient);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, { remote: this.remote });
  }
}
