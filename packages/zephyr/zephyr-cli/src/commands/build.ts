// `zephyr build`：编排三步并把结果报成一张表。
//
// 不装配任何清单：构建的输入是「布局 + 解析规则」。解析规则由应用在 `client.vite` 指的配置文件里
// 转手（框架层提供），CLI 只把产物位置与入口喂给 vite。
import { inject, Injectable, Logger } from "@morlay/zephyr";
import { BuildSteps, runBuild } from "../build/builder.ts";
import { Command, type CommandInput } from "../command.ts";
import { Workspace } from "../config/contract.ts";
import type { ParamSpecs } from "../params.ts";

/** `zephyr build`。 */
@Injectable({ multi: true })
export class BuildCommand extends Command {
  readonly path = ["build"];

  readonly description =
    "产出静态面与运行时闭包（缺省 node_modules/.zephyr；preview 与桌面打包都吃它）";

  readonly params: ParamSpecs = {};

  private readonly steps = inject(BuildSteps);

  private readonly resolved = inject(Workspace);

  private readonly logger = inject(Logger);

  /**
   * @returns 退出码。
   */
  async run(_input: CommandInput): Promise<number> {
    const summary = await runBuild(
      { resolved: this.resolved, layout: this.resolved.layout },
      this.steps,
    );
    for (const step of summary.steps) {
      this.logger.info(
        "[build] %s  %dms%s",
        step.name,
        step.ms,
        step.detail === undefined ? "" : `  ${step.detail}`,
      );
    }
    this.logger.info("[build] 完成：%s", summary.dist);
    return 0;
  }
}
