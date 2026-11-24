// 开发态的换树契约：**何时可以换**由实现说，**怎么换**归装配面（CLI 的 `dev` 命令：拆旧树、起新树、
// 卡住就退出——那些护栏与具体框架无关，不该每个应用抄一遍）。
//
// 「忙不忙」的**域**那一半不在这里：各域登记 `IdleGuard`（`./idle-guard`），实现汇总它们；
// 装配面因此只需交出「怎么换」，不必知道哪些令牌算忙。
//
// `zephyr-app` 只声明这条缝；实现由开发运行时给（dev 形态的 `ServerHmr`），生产态不装。
import { Injectable } from "@morlay/zephyr";

/** 换树的钩子（装配面给）。 */
export interface DevHmrHooks {
  /**
   * 真的要换树时调用。
   * @param files - 这一轮累积的变化文件（绝对路径）。
   */
  readonly restart: (files: readonly string[]) => Promise<void>;
}

@Injectable({ name: "hmr" })
export abstract class DevHmr {
  /**
   * 装上钩子，开始盯变更。
   * @param hooks - 见 {@link DevHmrHooks}。
   * @returns 撤销函数（卸载前调用：停订阅、忘掉钩子）。
   */
  abstract install(hooks: DevHmrHooks): void | (() => void);
}
