// 一条只用于验证「插件追加命令」的假命令：能被配置以绝对路径 import 进清单。
import { inject, Injectable, Logger } from "@morlay/zephyr";
import { Command, type CommandInput } from "../command.ts";
import type { ParamSpecs } from "../params.ts";

/** 回显剩下的位置参数，退出码固定 7（便于断言「命令真的跑了」）。 */
@Injectable({ multi: true })
export class EchoCommand extends Command {
  readonly path = ["echo"];

  readonly description = "回显实参（仅测试用）";

  readonly params: ParamSpecs = {
    loud: { kind: "boolean", description: "加感叹号" },
  };

  private readonly logger = inject(Logger);

  /**
   * @param input - 参数与形态。
   * @returns 固定退出码 7。
   */
  async run(input: CommandInput): Promise<number> {
    this.logger.info(
      "echo %s%s",
      input.mode.command.join(" "),
      input.params.loud === true ? "!" : "",
    );
    return 7;
  }
}
