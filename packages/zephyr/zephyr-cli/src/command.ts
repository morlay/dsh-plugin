// 命令契约：**命令就是一个装配行**。
//
// 一个命令要能被 CLI 看见，只需被 `provide()` 进清单——它自己不知道树长什么样，也不知道
// 自己是被谁调起来的。树是 CLI 根的职责（见 `./tree.ts`）。
import { Injectable } from "@morlay/zephyr";
import type { CliModeValues } from "./mode.ts";
import type { ParamSpecs, ParamValue } from "./params.ts";

/** 跑一个命令时拿到的输入。 */
export interface CommandInput {
  /** 参数取值（键与命令声明的 `params` 一致）。 */
  readonly params: Readonly<Record<string, ParamValue>>;
  /** 没有被任何声明消费的位置实参（插件要自己解释时用）。 */
  readonly rest: readonly string[];
  /** 这一次运行的形态与部署参数（工作区、数据目录、端口…）。 */
  readonly mode: CliModeValues;
}

/**
 * 命令契约。
 *
 * 实现类必须再写一次 `@Injectable({ multi: true })`：zephyr 的令牌元数据按「继承就复用」推导，
 * 但多值标记不会自动继承——漏写会让命令变成单值令牌，第二个命令就被静默覆盖。
 */
@Injectable({ multi: true })
export abstract class Command {
  /** 命令在树里的位置：`['dev']`、`['desktop', 'bundle']`。 */
  abstract readonly path: readonly string[];

  /** `--help` 与父命令列表里的一句话说明。 */
  abstract readonly description: string;

  /** 参数声明；声明即自动注册为 flags（见 `./params.ts`）。 */
  readonly params: ParamSpecs = {};

  /**
   * 执行。
   * @param input - 参数、剩余实参与运行形态。
   * @returns 退出码；`undefined` 视为 0。
   */
  abstract run(input: CommandInput): Promise<number | void>;
}
