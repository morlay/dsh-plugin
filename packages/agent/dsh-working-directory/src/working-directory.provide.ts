import { Injectable, provide } from "@morlay/zephyr";
import { WorkingDirectoryDefault } from "./working-directory.service.ts";
import { AgentProviderGroup } from "@morlay/dsh-agent-contract";

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
/**
 * 本域按 agent 分层的条目：各域声明自己的，装配面只装 group（单一职责）。
 *
 * 这些插件**仍装在 root**：它们内部用 `agent.ctx` / `scopeOf(ctx)` 把状态按 agent 分开，
 * 需要的是"全局一份 + 分层"，不是"每个 agent 一份实例"。
 */
@Injectable({ multi: true })
export class WorkingDirectoryAgentGroup extends AgentProviderGroup {
  readonly entries = [WorkingDirectoryDefault];
}

export const provideWorkingDirectory = provide([WorkingDirectoryAgentGroup, 
  { provide: WorkingDirectoryDefault, config: { defaultDirectory: process.cwd() } },
]);
