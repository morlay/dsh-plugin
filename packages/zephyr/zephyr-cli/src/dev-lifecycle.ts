// 开发形态的生命周期口：**HMR 属于应用，重启属于 CLI**。
//
// CLI 不知道 vite、也不知道 `ServerHmr`（那是 zephyr-app 的 internal），它只提供这个可选注入点：
// 应用（或框架包）把「什么时候可以换树、源码变了要重载」告诉 CLI，换树的动作由 CLI 做——
// 因为「先拆后起、卡住就退出」这两条护栏是 CLI 的职责，不该每个应用抄一遍。
import { Injectable } from "@morlay/zephyr";

/** 重载钩子。 */
export interface DevLifecycleHooks {
  /**
   * 重载：拆掉旧树、装配新树。
   * @param files - 触发重载的文件（只用于日志）。
   */
  restart(files: readonly string[]): Promise<void>;
}

/** 开发形态生命周期契约。 */
@Injectable()
export abstract class DevLifecycle {
  /**
   * 装上钩子。应用在这里把自己的变更监听接到 `hooks.restart`。
   * @param hooks - CLI 提供的动作。
   */
  abstract install(hooks: DevLifecycleHooks): void | Promise<void>;
}
