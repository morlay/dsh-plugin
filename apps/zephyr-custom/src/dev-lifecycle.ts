// 开发形态的生命周期：把框架的 `ServerHmr`（vite 的变更监听 + 空闲判据）接到 CLI 的重载口上。
//
// 为什么要适配而不用 CLI 直接认 `ServerHmr`：CLI 不该知道 vite，也不该依赖 `@morlay/zephyr-app`
// 的 internal；它只认「可以重载了」这件事。拆旧树、装配新树、卡住就退出——那些护栏在 CLI 里，
// 因为它们与具体框架无关。
import { inject, Injectable } from "@morlay/zephyr";
import { DevLifecycle, type DevLifecycleHooks } from "@morlay/zephyr-cli";
import { ServerHmr } from "@morlay/zephyr-app";
import { ViteHandoff } from "@morlay/zephyr-app";
import { AgentDirectory } from "@morlay/dsh-agent";
import { JobRegistry } from "@morlay/dsh-job";

/** 把 vite 的变更监听接到 CLI 的重载口。 */
@Injectable()
export class CustomDevLifecycle extends DevLifecycle {
  private readonly hmr = inject.optional(ServerHmr);

  private readonly handoff = inject.optional(ViteHandoff);

  private readonly agents = inject.optional(AgentDirectory);

  private readonly jobs = inject.optional(JobRegistry);

  /**
   * @param hooks - CLI 提供的重载动作。
   */
  install(hooks: DevLifecycleHooks): void {
    const hmr = this.hmr;
    const handoff = this.handoff;
    // 非 dev 形态（或装了替身）没有这两个行：静默不装，CLI 那侧就不会有重载。
    if (hmr === undefined || handoff === undefined) return;
    hmr.install({
      isIdle: () => this.isIdle(),
      reload: (files) => hooks.restart(files),
    });
    handoff.onServerSourceChange((file) => hmr.notify(file));
  }

  /**
   * 业务层空闲：没有 Agent 开着 turn，也没有后台任务在跑。
   *
   * 换树会让在途的东西半路换手：turn 开着时模型调用在途；后台任务跑着时它的输出管道挂在
   * 被换掉的行上。`finishedAt` 缺失就是还活着。
   * @returns 是否空闲。
   */
  private isIdle(): boolean {
    const agents = this.agents;
    const jobs = this.jobs;
    return (
      (agents === undefined ||
        agents
          .list()
          .every((agent) => agents.turnBoundaryOf(agent.session).openTurnStartSeq === null)) &&
      (jobs === undefined || jobs.list().every((job) => job.finishedAt !== undefined))
    );
  }
}
