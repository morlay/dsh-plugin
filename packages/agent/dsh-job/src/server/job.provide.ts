import { provide, type ProviderList } from "@morlay/zephyr";
import { JobControllerRow } from "../job-controller.row.ts";
import { JobEndpointDefault } from "./job-endpoint.service.ts";
import { ToolJobs } from "./tool-jobs.service.ts";
import { JobRegistryDefault } from "../job-registry.service.ts";

// 注册表 + 它的工具行（`job_list` / `job_output` / `job_kill`）+ `remote.job` 的宿主面。
const providers = (): ProviderList => [
  JobRegistryDefault,
  ToolJobs,
  // 上游 `JobController` 的适配行 + 继承 `endpoint/` 契约的端点行。
  JobControllerRow,
  JobEndpointDefault,
];

export const provideJob = provide(providers());
