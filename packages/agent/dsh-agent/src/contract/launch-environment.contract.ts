// 启动环境契约：宿主启动时注入的快照（平台、可用 shell、初始 cwd 等）。
//
// 上游没有这一层服务类：它的真源是 `@deepseek-ai/dsh-launch-environment` 的
// `LaunchEnvironmentSnapshot` 与 `ctx.launchEnvironment` 槽（消费方用 `launchEnvironmentOf(ctx)` 读）。
// 所以这里没有「覆盖上游服务全部成员」这回事——契约只有一条：**把那个快照原样交出去**，
// 消费方注入 `LaunchEnvironment` 就能读到与 `launchEnvironmentOf(ctx)` 同一个值。
//
// 所以**不写** `@Injectable({ name: "launchEnvironment" })`：那个名字上是**快照值**（`ctx.get(…)` 读它），
// 按别名再发一份会把服务实例压在同一个槽上——之后 `launchEnvironmentOf(ctx)` 取到的就不是快照了。
import type { LaunchEnvironmentSnapshot } from "@deepseek-ai/dsh-launch-environment";
import { Injectable } from "@morlay/zephyr";

/**
 * 启动快照的最小读面：一个变量名 → 它的值。
 *
 * 需要它的地方（如 provider 头里的 `${NAME}` 引用）只读一个名字，不关心值来自哪一层。
 */
export interface LaunchEnvironmentLookup {
  get(name: string): { readonly value: string } | undefined;
}

@Injectable()
export abstract class LaunchEnvironment {
  /** 启动快照：没有装配行时是 `undefined`（消费方按「未提供」处理）。 */
  abstract readonly snapshot: LaunchEnvironmentSnapshot | undefined;
}
