// job 域的**浏览器半装配**：`job` 那组 remote 的客户端形态 + 后台任务的数据面（`jobs`）+ 任务列表。
//
// 三行都落在会话界面上（面板一节由上游 `ui-session-panel` 声明），装配面把它排在
// `provideConversationUi()` 之后；彼此之间是 `inject` 声明的边，由拓扑排序保证顺序：
// `JobEndpointClient`（挂 `job` 那组 descriptor）→ `JobsClient`（消费它）→ `JobListSlots`（读 `jobs`）。
import { provide, type ProviderList } from "@morlay/zephyr";
import { JobEndpointClient } from "./job-endpoint.client.ts";
import { JobsClient } from "./jobs-client.service.ts";
import { JobListSlots } from "./job-list.slots.ts";

/**
 * 后台任务的浏览器半清单。
 * @returns provider 清单。
 */
export function provideJobUi(): ProviderList {
  return provide([JobEndpointClient, JobsClient, JobListSlots])();
}
