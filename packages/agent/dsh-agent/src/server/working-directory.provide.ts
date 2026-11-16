import { Injectable, provide } from "@morlay/zephyr";
import { WorkingDirectoryDefault } from "../working-directory.service.ts";
import { AgentProviderGroup } from "../contract/index.ts";

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

/**
 * 部署默认目录：清单里**不写死**值——缺省由 `WorkingDirectoryDefault` 从 `AppEnv` 取
 * （环境事实只有一个来源，见 `WorkingDirectoryConfig.defaultDirectory`）。
 *
 * 装配面要换值：`provideWorkingDirectory(configure(WorkingDirectoryDefault, { defaultDirectory }))`
 * ——feature 与清单合并后显式给的那个值优先。
 */
export const provideWorkingDirectory = provide([
  WorkingDirectoryAgentGroup,
  WorkingDirectoryDefault,
]);
