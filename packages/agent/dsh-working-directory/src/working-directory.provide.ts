import { configure, provide } from "@morlay/zephyr";
import { WorkingDirectoryDefault } from "./working-directory.service.ts";

/** 部署默认目录：没有会话记录时 shell / 工具落在这里（必须是绝对路径，上游在构造期校验）。 */
export interface WorkingDirectoryConfig {
  readonly defaultDirectory: string;
}

/**
 * 部署默认目录，不给就是启动目录（`process.cwd()`）。
 *
 * 装配面要换值：`provideWorkingDirectory(configure(WorkingDirectoryDefault, { defaultDirectory }))`
 * （feature 与默认配置深合并）。
 */
export const provideWorkingDirectory = provide(
  configure(WorkingDirectoryDefault, { defaultDirectory: process.cwd() })([WorkingDirectoryDefault]),
);
