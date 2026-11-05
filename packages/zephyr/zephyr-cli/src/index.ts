// `@morlay/zephyr-cli` 的公开面：命令作者要的契约与语法糖，加上使用者要的入口。
//
// 三条边界：
// 1. **命令实现的默认动作不从这里出**（`BuilderDefault` 之外的真实构建细节都不导出）；
// 2. `internal/` 不存在——这个包本身就没有「只给自己看」的那一层；
// 3. 桌面命令不在这里：它们在 `@morlay/zephyr-desktop-bundle` 里，通过 `config.plugins` 内联展开。
export { Command, type CommandInput } from "./command.ts";
export { CliError, usageError } from "./errors.ts";
export {
  flagOf,
  helpOf,
  parseParams,
  usageOf,
  type ParamSpec,
  type ParamSpecs,
  type ParamValue,
} from "./params.ts";
export {
  buildCommandTree,
  childNamesOf,
  resolveCommand,
  type CommandMatch,
  type CommandNode,
} from "./tree.ts";
export { CliMode, type CliModeValues } from "./mode.ts";
export { provideCli, type ProvideCliOptions } from "./provide.ts";
export { CONFIG_FILENAME, loadConfig } from "./config/load.ts";
export { Workspace, type ResolvedConfig, type ZephyrConfig } from "./config/contract.ts";
export type {
  ZephyrBuildConfig,
  ZephyrClientConfig,
  ZephyrDesktopConfig,
  ZephyrServerConfig,
} from "./config/contract.ts";
export { layoutOf, type ZephyrLayout } from "./layout.ts";
export { resolveDataDir, type DataDirContext, type DataDirSpec } from "./data-dir.ts";
export {
  BuildSteps,
  buildClient,
  buildRuntime,
  bundleEntry,
  defaultBuildSteps,
  runBuild,
  type BuildInput,
  type BuildStep,
  type BuildSummary,
} from "./build/builder.ts";
export { DevLifecycle, type DevLifecycleHooks } from "./dev-lifecycle.ts";
export { loadServerProviders, type ServerProviders } from "./server-entry.ts";
export { CliLogger, isLogLevel, LOG_LEVELS, type LogLevel } from "./logger.ts";
export { GLOBAL_PARAMS, runCli, type CliStreams, type RunOptions } from "./run.ts";
export { BuildCommand } from "./commands/build.ts";
export { DevCommand } from "./commands/dev.ts";
export { PreviewCommand } from "./commands/preview.ts";
