// 工作目录：上游 `WorkingDirectoryService` 经 `fromCordis` 接管。
import { WorkingDirectoryService } from "@deepseek-ai/dsh-working-directory";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { AppEnv } from "@morlay/zephyr-app";
import { SystemPrompt, AgentScoped } from "@morlay/dsh-agent";
import { FileSystem } from "@morlay/dsh-fs";
import { SessionProjectionStore } from "@morlay/dsh-session";
import { WorkingDirectory } from "@morlay/dsh-agent";

/** 部署默认目录：没有会话记录时 shell / 工具落在这里（必须是绝对路径，上游在构造期校验）。 */
export interface WorkingDirectoryConfig {
  /**
   * 起始目录。
   *
   * 不给就取 `AppEnv.defaultWorkingDirectory`：环境事实只有 `AppEnv` 一个来源。
   * 它仍是**可覆盖的装配值**——「从哪儿开始」与「能写哪儿」是两件事，装配面可以分别给。
   */
  readonly defaultDirectory?: string;
}

@AgentScoped()
@Injectable()
export class WorkingDirectoryDefault extends fromCordis(WorkingDirectory, WorkingDirectoryService) {
  fs = inject(FileSystem);

  sessionProjections = inject(SessionProjectionStore);

  systemPrompt = inject(SystemPrompt);

  /**
   * 起始目录的缺省来源；注入而不是模块级常量（见 `WorkingDirectoryConfig.defaultDirectory`）。
   * 可选注入：显式 `configure` 了目录的行不需要它。
   */
  private readonly appEnv = inject.optional(AppEnv);

  override async onInit(ctx: Context): Promise<void> {
    const config = (this.rowConfig ?? {}) as WorkingDirectoryConfig;
    // 行配置优先，`AppEnv` 只补缺省。
    const defaultDirectory = config.defaultDirectory ?? this.appEnv?.defaultWorkingDirectory;
    if (defaultDirectory === undefined) {
      throw new Error(
        "working-directory: 没有部署默认目录——装 AppEnv，或 " +
          "configure(WorkingDirectoryDefault, { defaultDirectory })（不拿进程 cwd 兜底）",
      );
    }
    await this.mount(
      ctx,
      { ...config, defaultDirectory },
      {
        fs: this.fs,
        sessionProjections: this.sessionProjections,
        systemPrompt: this.systemPrompt,
      },
    );
  }
}
