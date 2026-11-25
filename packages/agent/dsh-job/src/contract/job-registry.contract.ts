// 后台任务契约：令牌按服务语义命名（上游注册名 `jobs`）。
import type JobRegistryService from "@deepseek-ai/dsh-jobs";
import { Injectable } from "@morlay/zephyr";

@Injectable({ name: "jobs" })
export abstract class JobRegistry implements JobRegistryService {
  abstract readonly list: JobRegistryService["list"];

  abstract readonly get: JobRegistryService["get"];

  abstract readonly start: JobRegistryService["start"];

  abstract readonly attachController: JobRegistryService["attachController"];

  abstract readonly events: JobRegistryService["events"];

  abstract readonly kill: JobRegistryService["kill"];

  abstract readonly read: JobRegistryService["read"];

  abstract readonly readAt: JobRegistryService["readAt"];

  abstract readonly remove: JobRegistryService["remove"];

  abstract readonly wait: JobRegistryService["wait"];
}
