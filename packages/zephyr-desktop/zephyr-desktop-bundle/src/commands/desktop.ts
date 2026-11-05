// `zephyr desktop`：桌面形态的父命令。
//
// 它自己不干活，只把「桌面有哪两个阶段」说出来。注册它是硬要求——树里没有父命令的路径算装配错误
// （见 zephyr-cli 的 `buildCommandTree`）。
import { inject, Injectable, Logger } from "@morlay/zephyr";
import { Command, type CommandInput } from "@morlay/zephyr-cli";
import type { ParamSpecs } from "@morlay/zephyr-cli";

/** `zephyr desktop`。 */
@Injectable({ multi: true })
export class DesktopCommand extends Command {
  readonly path = ["desktop"];

  readonly description = "桌面形态：dev 在壳里跑开发形态，bundle 打成应用目录";

  readonly params: ParamSpecs = {};

  private readonly logger = inject(Logger);

  /**
   * @returns 退出码 2（父命令只做分组，不该被当命令执行）。
   */
  async run(_input: CommandInput): Promise<number> {
    this.logger.info("用法: zephyr desktop <dev|bundle>");
    return 2;
  }
}
