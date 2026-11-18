import { provide } from "@morlay/zephyr";
import { remoteDescriptor } from "@morlay/zephyr-app";
import { JobControllerRow } from "../job-controller.service.ts";
import { JobEndpointDefault } from "./job-endpoint.service.ts";
import { ToolJobs } from "./tool-jobs.service.ts";
import { JobRegistryDefault } from "../job-registry.service.ts";

// 注册表 + 它的工具行（`job_list` / `job_output` / `job_kill`）+ `remote.job` 的宿主面。
//
// 装配位置**这一票不动**（注册表仍在应用根）：它内部按 `scopeOf(ctx)` 分层。按 scope 装配要连着
// 消费方（`ToolJobs` / `JobControllerRow` / `JobIdleGuard`）一起量，见设计记录的「迁移面」。
export const provideJob = provide([
  JobRegistryDefault,
  ToolJobs,
  // 上游 `JobController` 的适配行 + 继承 `endpoint/` 契约的端点行。
  JobControllerRow,
  JobEndpointDefault,
  remoteDescriptor(() => import("@deepseek-ai/dsh-api-job-controller/remote")),
]);
