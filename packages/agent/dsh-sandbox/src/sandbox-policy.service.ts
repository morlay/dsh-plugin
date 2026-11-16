// 沙箱策略：上游 `SandboxPolicyService` 经 `fromCordis` 接管。
import { SandboxPolicyService } from "@deepseek-ai/dsh-sandbox-policy";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { AppEnv } from "@morlay/zephyr-app";
import { SessionProjectionStore } from "@morlay/dsh-session";
import { SandboxPolicy, type SandboxMode } from "./contract/index.ts";

/** 沙箱的策略输入：部署默认模式与 `workspace-write` 的兜底根。 */
export interface SandboxConfig {
  /** 会话覆盖之下的部署默认模式。 */
  readonly mode: SandboxMode;
  /**
   * 没有会话 cwd 的调用按这个根做 `workspace-write` 边界。
   *
   * 不给就取 `AppEnv.defaultWorkingDirectory`：环境事实只有 `AppEnv` 一个来源。它仍是**可覆盖的
   * 装配值**——装配面给了就原样用（收紧沙箱不必连起始目录一起改）。
   */
  readonly workspaceRoot?: string;
}

@Injectable()
export class SandboxPolicyDefault extends fromCordis(SandboxPolicy, SandboxPolicyService) {
  sessionProjections = inject(SessionProjectionStore);

  /**
   * 兜底根的缺省来源。
   *
   * 注入而不是模块级 `DEFAULTS` 的字段：`AppEnv` 是**运行期**给的值（打包形态的起始目录不是进程
   * cwd），写成常量就等于在装配面之外又猜了一次 cwd。可选注入：显式 `configure` 了根的行不需要它。
   */
  private readonly appEnv = inject.optional(AppEnv);

  override async onInit(ctx: Context): Promise<void> {
    const config = (this.rowConfig ?? {}) as Partial<SandboxConfig>;
    // 行配置优先，`AppEnv` 只补缺省。
    const workspaceRoot = config.workspaceRoot ?? this.appEnv?.defaultWorkingDirectory;
    if (workspaceRoot === undefined) {
      throw new Error(
        "sandbox-policy: 没有 workspace-write 的兜底根——装 AppEnv，或 " +
          "configure(SandboxPolicyDefault, { workspaceRoot })（不拿进程 cwd 兜底）",
      );
    }
    await this.mount(
      ctx,
      { ...config, workspaceRoot },
      { sessionProjections: this.sessionProjections },
    );
  }
}
