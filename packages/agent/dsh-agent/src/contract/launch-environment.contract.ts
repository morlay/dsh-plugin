// 启动环境契约：宿主启动时注入的快照（平台、可用 shell、初始 cwd 等）。
//
// 上游没有这一层服务类：它的真源是 `@deepseek-ai/dsh-launch-environment` 的
// `LaunchEnvironmentSnapshot` 与 `ctx.launchEnvironment` 槽（消费方用 `launchEnvironmentOf(ctx)` 读）。
// 所以这里没有「覆盖上游服务全部成员」这回事——契约只有一条：**把那个快照原样交出去**，
// 消费方注入 `LaunchEnvironment` 就能读到与 `launchEnvironmentOf(ctx)` 同一个值。
import type { LaunchEnvironmentSnapshot } from "@deepseek-ai/dsh-launch-environment";
import { Injectable } from "@morlay/zephyr";

@Injectable()
export abstract class LaunchEnvironment {
  /** 启动快照：没有装配行时是 `undefined`（消费方按「未提供」处理）。 */
  abstract readonly snapshot: LaunchEnvironmentSnapshot | undefined;
}
