// job 域的**浏览器半**（`@morlay/dsh-job/ui`）：后台任务的数据面与会话头部的任务列表。
//
// 宿主半（注册表 + `job_list` 一族工具行 + `remote.job` 的宿主面）在 `./server`；这一面只服务浏览器树，
// 上游对应 `@deepseek-ai/dsh-api-job-controller/client` 与 `@deepseek-ai/dsh-client-ui-jobs/client`。
export { Jobs } from "./jobs.contract.ts";
export { JobsClient } from "./jobs-client.service.ts";
export { JobListSlots } from "./job-list.slots.ts";
export { provideJobUi } from "./job.provide.ts";
