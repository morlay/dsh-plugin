// `ctx.jobs` 契约（浏览器侧）：会话头部那份后台任务列表的数据面。
//
// 成员来自上游 `IJobs`（`dsh-api-job-controller/client` 的 `ClientJobs`）：按会话的 roster 快照、
// 引用计数的 roster 流与单个 job 的观察流、以及人工 kill。实现是 `JobsClient`（`fromCordis` 照装上游
// client 半，契约面就是它发布的服务）。
//
// **与宿主侧的 `JobRegistry` 同名不同树**：那条契约的服务名也是 `jobs`，但它住在 Node 树里
// （注册表 + `job_list` 一族工具行）；这条只存在于浏览器树，两者不会出现在同一个 ctx 上。
import type { IJobs } from "@deepseek-ai/dsh-api-job-controller/client";
import { Injectable } from "@morlay/zephyr";
import type { AssertCovered, AssertTrue } from "@morlay/zephyr-app/client";

/** 覆盖守卫：上游 `IJobs` 有而契约没列出的成员，编译期必须为空。 */
export type JobsCovered = AssertTrue<AssertCovered<IJobs, Jobs>>;

/** `ctx.jobs`：本会话可见的后台任务与它们的观察流。 */
@Injectable({ name: "jobs" })
export abstract class Jobs {
  abstract readonly state: IJobs["state"];

  abstract readonly watchRows: IJobs["watchRows"];

  abstract readonly observe: IJobs["observe"];

  abstract readonly kill: IJobs["kill"];
}
