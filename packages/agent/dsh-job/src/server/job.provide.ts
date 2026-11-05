import { Injectable, provide } from "@morlay/zephyr";
import { JobControllerRow } from "../job-controller.row.ts";
import { JobEndpointDefault } from "./job-endpoint.service.ts";
import { ToolJobs } from "./tool-jobs.service.ts";
import { JobRegistryDefault } from "../job-registry.service.ts";
import { AgentProviderGroup } from "@morlay/dsh-agent-contract";

// 注册表 + 它的工具行（`job_list` / `job_output` / `job_kill`）+ `remote.job` 的宿主面。
/**
 * 本域按 agent 分层的条目：各域声明自己的，装配面只装 group（单一职责）。
 *
 * 这些插件**仍装在 root**：它们内部用 `agent.ctx` / `scopeOf(ctx)` 把状态按 agent 分开，
 * 需要的是"全局一份 + 分层"，不是"每个 agent 一份实例"。
 */
@Injectable({ multi: true })
export class JobAgentGroup extends AgentProviderGroup {
  readonly entries = [JobRegistryDefault];
}

export const provideJob = provide([JobAgentGroup, 
  JobRegistryDefault,
  ToolJobs,
  // 上游 `JobController` 的适配行 + 继承 `endpoint/` 契约的端点行。
  JobControllerRow,
  JobEndpointDefault,
]);
