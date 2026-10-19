// workspace 聚合面：具体实现由适配类接管上游插件（`fromCordis`），消费方 `inject(WorkspaceRegistry)`。
import WorkspaceRegistryService from "@deepseek-ai/dsh-workspace";
import { inject, Injectable, Logger, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { WorkspaceRegistry } from "./contract/workspace.contract.ts";
import { SessionPersistence } from "@morlay/dsh-session-persistence";
import { StorageDomain } from "@morlay/dsh-storage";

@Injectable()
export class Workspace extends fromCordis(WorkspaceRegistry, WorkspaceRegistryService) {
  storageDomain = inject(StorageDomain);

  sessionPersistence = inject(SessionPersistence);

  // 上游 `WorkspaceRegistry` 在 init 与 `reportFilteredCandidates` 里读 `ctx.logger.warn`：
  // logger 是**必需**依赖，必须显式交进去（行作用域自己拿不到根 ctx 的 logger）。
  logger = inject(Logger);

  protected override async onInit(ctx: Context): Promise<void> {
    if (this.logger === undefined) {
      throw new Error(
        "Workspace 需要 Logger（上游 WorkspaceRegistry 读 ctx.logger.warn）：装配面要提供 Logger 契约",
      );
    }
    await this.mount(ctx, undefined, {
      storageDomain: this.storageDomain,
      sessionPersistence: this.sessionPersistence,
      logger: this.logger,
    });
  }
}

export {
  WorkspaceActiveSessionError,
  WorkspaceArchivedSessionPinError,
  WorkspaceOrderInvalidError,
  WorkspaceUnknownSessionError,
} from "@deepseek-ai/dsh-workspace";
