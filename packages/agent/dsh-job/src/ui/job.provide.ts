// job 域的**浏览器半装配**：后台任务的数据面（`jobs`）+ 会话头部的任务列表（`job-list`）。
//
// 两行都落在会话界面上（头部动作位由上游 `ui-conversation` 声明），装配面把它排在
// `provideConversationUi()` 之后；彼此之间是 `inject(Jobs)` 一条边，由拓扑排序保证顺序。
import { provide, type ProviderList } from "@morlay/zephyr";
import { JobsClient } from "./jobs-client.service.ts";
import { JobListSlots } from "./job-list.slots.ts";

/**
 * 后台任务的浏览器半清单。
 * @returns provider 清单。
 */
export function provideJobUi(): ProviderList {
  return provide([JobsClient, JobListSlots])();
}
