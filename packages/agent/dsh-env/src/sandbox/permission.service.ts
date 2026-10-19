// 权限预设：上游 `PermissionPresetService` 经 `fromCordis` 接管。
import PermissionPresetService from "@deepseek-ai/dsh-permission-presets";
import { Injectable, inject, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Permission } from "./permission.contract.ts";
import { SessionStore } from "@morlay/dsh-session";
import { SessionProjections } from "@morlay/dsh-session";
import { ShellExecutor } from "./shell.contract.ts";
import { Approval } from "./approval.contract.ts";

@Injectable()
export class PermissionDefault extends fromCordis(Permission, PermissionPresetService) {
  shell = inject(ShellExecutor);

  approval = inject(Approval);

  sessions = inject(SessionStore);

  sessionProjections = inject(SessionProjections);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      shell: this.shell,
      approval: this.approval,
      sessions: this.sessions,
      sessionProjections: this.sessionProjections,
    });
  }
}
