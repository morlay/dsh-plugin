// 开发形态的生命周期：把框架的 `DevHmr`（换树时机）接到 CLI 的重载口上。
//
// 为什么要适配而不用 CLI 直接认 `DevHmr`：CLI 不该知道前端资产是 vite 还是静态目录，也不该依赖
// `@morlay/zephyr-app` 的实现行；它只认「可以重载了」这件事。拆旧树、装配新树、卡住就退出——
// 那些护栏在 CLI 里，因为它们与具体框架无关。
//
// **这里不做变更桥接**：哪些文件变了归 `ClientAssets`（谁服务前端资产谁认得出「服务端那半变了」），
// `DevHmr` 的实现自己向它订阅；应用侧只把「业务层空不空闲」与「换树的动作」交出去。
import { inject, Injectable } from "@morlay/zephyr";
import { DevLifecycle, type DevLifecycleHooks } from "@morlay/zephyr-cli";
import { DevHmr } from "@morlay/zephyr-app";
import { AgentDirectory } from "@morlay/dsh-agent";
import { JobRegistry } from "@morlay/dsh-job";

/** 把 `DevHmr` 接到 CLI 的重载口。 */
@Injectable()
export class CustomDevLifecycle extends DevLifecycle {
  /** 开发形态才有：非 dev 形态没人装 `DevHmr`，这里就是 `undefined`（CLI 那侧也就不会有重载）。 */
  private readonly hmr = inject.optional(DevHmr);

  private readonly agents = inject.optional(AgentDirectory);

  private readonly jobs = inject.optional(JobRegistry);

  /**
   * @param hooks - CLI 提供的重载动作。
   */
  install(hooks: DevLifecycleHooks): void {
    this.hmr?.install({
      isIdle: () => this.isIdle(),
      restart: (files) => hooks.restart(files),
    });
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
