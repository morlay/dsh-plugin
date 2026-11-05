// 内核的装配清单：**命令是行，值也是行**。
//
// 核心三条命令永远在清单里（help 因此稳定）；插件只往清单里追加自己的命令。CLI 自己的装配
// 不写在配置里——配置描述的是「这个工作区是什么」。
import { Logger, type ProviderList } from "@morlay/zephyr";
import { BuildSteps, defaultBuildSteps } from "./build/builder.ts";
import { BuildCommand } from "./commands/build.ts";
import { DevCommand } from "./commands/dev.ts";
import { PreviewCommand } from "./commands/preview.ts";
import { Workspace, type ResolvedConfig } from "./config/contract.ts";
import { CliLogger, type LogLevel } from "./logger.ts";
import { CliMode, type CliModeValues } from "./mode.ts";

/** 装配内核需要的值。 */
export interface ProvideCliOptions {
  /** 本次运行的部署参数。 */
  readonly mode: CliModeValues;
  /** 解析后的工作区配置。 */
  readonly resolved: ResolvedConfig;
  /** 日志阈值（缺省 `info`）。 */
  readonly logLevel?: LogLevel;
  /** 输出流（缺省进程的 stdout/stderr；测试里换成收集器）。 */
  readonly streams?: {
    readonly stdout: (line: string) => void;
    readonly stderr: (line: string) => void;
  };
}

/**
 * 内核清单：值行 + 三条命令 + 默认构建器。
 * @param options - 部署参数与配置。
 * @returns 可以直接跟在 `config.plugins` 后面的清单。
 */
export function provideCli(options: ProvideCliOptions): ProviderList {
  return [
    { provide: CliMode, useValue: options.mode },
    { provide: Workspace, useValue: options.resolved },
    { provide: Logger, useValue: new CliLogger(options.logLevel ?? "info", options.streams) },
    { provide: BuildSteps, useValue: defaultBuildSteps() },
    DevCommand,
    BuildCommand,
    PreviewCommand,
  ];
}
