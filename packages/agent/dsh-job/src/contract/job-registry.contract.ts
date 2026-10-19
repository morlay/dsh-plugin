// 后台任务契约：令牌按服务语义命名（上游注册名 `jobs`）。
import type JobRegistryService from "@deepseek-ai/dsh-jobs";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";

/**
 * 契约面：上游 `JobRegistry` 的**全部**公开成员。
 *
 * 上游插件按 `ctx.jobs.<member>` 取用，缺一个那条插件在运行期读到的就是 `undefined`；
 * 下面的覆盖守卫在编译期核对，漏一个就报出成员名。
 */
/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type JobsCovered = AssertTrue<AssertCovered<JobRegistryService, JobRegistry>>;

@Injectable()
export abstract class JobRegistry {
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

