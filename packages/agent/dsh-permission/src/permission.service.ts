// 权限预设：上游 `PermissionPresetService` 经 `fromCordis` 接管。
import PermissionPresetService from "@deepseek-ai/dsh-permission-presets";
import { Injectable, inject, Logger, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { AgentDirectory } from "@morlay/dsh-agent";
import { SessionProjectionStore, SessionStore } from "@morlay/dsh-session";
import { Setting } from "@morlay/dsh-setting";
import { ShellExecutor } from "@morlay/dsh-shell";
import { Approval } from "./contract/approval.contract.ts";
import { Permission } from "./contract/permission.contract.ts";

/**
 * 默认档位（新会话的初始权限）在设置文档里的命名空间。
 * 上游 client 行（`ui-permission-presets` 的 settings store）写的就是这个名字。
 */
export const PERMISSION_SETTINGS_NAMESPACE = "permission";

/** 装配项：预设表与新会话的初始档位（默认值由 `providePermission` 的清单条目给）。 */
export interface PermissionConfig {
  /** 预设表：档位名 → 开关组合。 */
  readonly presets?: Record<string, unknown>;
  /** 新会话的初始档位。 */
  readonly defaultPreset?: string;
}

@Injectable()
export class PermissionDefault extends fromCordis(Permission, PermissionPresetService) {
  shell = inject(ShellExecutor);

  approval = inject(Approval);

  sessions = inject(SessionStore);

  sessionProjections = inject(SessionProjectionStore);

  agents = inject(AgentDirectory);

  /**
   * 设置文档：用户选过的默认档位落在这里。
   * optional：只有权限域的装配（spec）没有设置模块，那时只用装配给的默认档位。
   */
  private readonly setting = inject.optional(Setting);

  private readonly logger = inject(Logger);

  /** 行配置（清单条目给的预设表与默认档位；基类接住构造参数，默认值由上游 schema 补）。 */
  /** 行配置（清单条目给的预设表与默认档位；基类接住构造参数，默认值由上游 schema 补）。 */
  private get rowOptions(): PermissionConfig {
    // `rowConfig` 是适配基类接住的装配值（`mount` 的缺省值），这里只做类型收窄。
    return (this.rowConfig ?? {}) as PermissionConfig;
  }

  override async onInit(ctx: Context): Promise<void> {
    const configured = this.rowOptions.defaultPreset;
    const presets = this.rowOptions.presets;
    const persisted = this.persistedDefaultPreset();
    if (this.setting !== undefined && persisted === undefined && configured !== undefined) {
      // 首次启动把装配值写进文档：设置页按文档键枚举命名空间，没有这一条那一行不会出现。
      this.setting.update(PERMISSION_SETTINGS_NAMESPACE, { defaultPreset: configured });
    }
    const accepted =
      persisted !== undefined && presets !== undefined && Object.hasOwn(presets, persisted)
        ? persisted
        : configured;
    if (persisted !== undefined && accepted !== persisted) {
      this.logger.warn(
        `permission: 设置里的默认档位 "${persisted}" 不在装配的预设表里，回落到 "${String(configured)}"`,
      );
    }
    // 用户选过的默认档位要覆盖装配值：在 `mount` 前换掉配置里的这一项（上游只读一次配置）。
    const mountConfig: PermissionConfig =
      accepted !== configured && accepted !== undefined
        ? { ...this.rowOptions, defaultPreset: accepted }
        : this.rowOptions;
    await this.mount(ctx, mountConfig, {
      shell: this.shell,
      approval: this.approval,
      sessions: this.sessions,
      sessionProjections: this.sessionProjections,
      agents: this.agents,
    });
  }

  /** 设置文档里持久化的默认档位；没有（或不是非空字符串）就是 `undefined`。 */
  private persistedDefaultPreset(): string | undefined {
    const section = this.setting?.snapshot()[PERMISSION_SETTINGS_NAMESPACE];
    if (typeof section !== "object" || section === null) return undefined;
    const value = (section as { defaultPreset?: unknown }).defaultPreset;
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }
}
