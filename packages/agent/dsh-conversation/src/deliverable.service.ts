// 交付物域的宿主半：两条行。
//
// - `WorkspaceChangesDefault`（`workspaceChanges` 服务）：变更摘要与 diff 的数据源；
// - `DeliverablesHostDefault`（`/api/present.*` 与 `/api/changes.*` 四条 HTTP 路由的注册方）。
//
// 这两行**必须一起装**：路由读 `workspaceChanges` 拿变更摘要，只装路由那一行会在 `present.host` 上
// 拿到的是「连接在、数据源不在」的 500，比 404 更难查。
//
// 上游两行都是**函数插件**（`export function apply`，没有 default export）：`fromCordis` 收 namespace。
import * as WorkspaceChangesPlugin from "@deepseek-ai/dsh-workspace-changes";
import * as DeliverablesHostPlugin from "@deepseek-ai/dsh-client-ui-deliverables";
import { FileSystem } from "@morlay/dsh-fs";
import { SandboxPolicy } from "@morlay/dsh-sandbox";
import { SessionQuery } from "@morlay/dsh-session";
import { SessionControllerService } from "@morlay/dsh-conversation";
import { Subprocess } from "@morlay/dsh-shell";
import { WorkspaceFilesDefault } from "@morlay/dsh-workspace/server";
import { Connection } from "@morlay/zephyr-app";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";

/**
 * `workspaceChanges` 服务：工作区变更的采集与比较（`git status` / `numstat` 那一层）。
 *
 * 上游 `inject = ['subprocess', 'fs']`：两个都由装配面交进去。
 */
@Injectable()
export class WorkspaceChangesDefault extends fromCordis(WorkspaceChangesPlugin) {
  private readonly subprocess = inject(Subprocess);

  private readonly fs = inject(FileSystem);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, { subprocess: this.subprocess, fs: this.fs });
  }
}

/**
 * 交付物路由那一行：注册 `/api/present.host` / `/api/present.open` / `/api/changes.open` /
 * `/api/changes.diff`（浏览器半的 `Deliverables` 与 `ChangedFiles` 视图靠它们）。
 *
 * 上游 `inject` 七件全由装配面交进去——任何一个缺席，路由注册时读到的就是 `undefined`。
 */
@Injectable()
export class DeliverablesHostDefault extends fromCordis(DeliverablesHostPlugin) {
  private readonly connection = inject(Connection);

  private readonly sessionQuery = inject(SessionQuery);

  private readonly sessionController = inject(SessionControllerService);

  // `workspaceFiles` 没有本仓自己的契约类：沙箱那行的适配行（`WorkspaceFilesDefault`）就是它的令牌，
  // 注入拿到的契约面是上游实例本身。
  private readonly workspaceFiles = inject(WorkspaceFilesDefault);

  private readonly fs = inject(FileSystem);

  private readonly sandboxPolicy = inject(SandboxPolicy);

  private readonly workspaceChanges = inject(WorkspaceChangesDefault);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      connection: this.connection,
      sessionQuery: this.sessionQuery,
      sessionController: this.sessionController,
      workspaceFiles: this.workspaceFiles,
      fs: this.fs,
      sandboxPolicy: this.sandboxPolicy,
      workspaceChanges: this.workspaceChanges,
    });
  }
}
