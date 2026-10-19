// workspace 聚合面：具体实现由适配类接管上游插件（`fromCordis`），消费方 `inject(WorkspaceRegistry)`。
import WorkspaceRegistryService from "@deepseek-ai/dsh-workspace";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { WorkspaceRegistry } from "./contract.ts";
import { SessionPersistence } from "@deepseek-ai/dsh-session-persistence";
import { StorageDomain } from "@morlay/dsh-storage";

@Injectable()
export class Workspace extends fromCordis(WorkspaceRegistry, WorkspaceRegistryService) {
  storageDomain = inject(StorageDomain);

  sessionPersistence = inject(SessionPersistence);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      storageDomain: this.storageDomain,
      sessionPersistence: this.sessionPersistence,
    });
  }
}

export {
  WorkspaceActiveSessionError,
  WorkspaceArchivedSessionPinError,
  WorkspaceOrderInvalidError,
  WorkspaceUnknownSessionError,
} from "@deepseek-ai/dsh-workspace";
