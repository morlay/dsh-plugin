// `workspaceFiles` 组的**适配行**：上游 `WorkspaceFiles` 宿主服务（`fromCordis` 接管），只负责把它装起来。
//
// 上游提供方是 `@deepseek-ai/dsh-api-workspace-files`（`static inject = ['fs','sandboxPolicy','sessions','typert']`），
// 读/列/观察的实现（分页、字节上限、NUL 判定、变更 feed、workspace 归属校验）都在它里面，本行不重写。
//
// 为什么拆成两行：wire 端点行要 `extends WorkspaceFilesEndpoint`（组名与方法名从契约的原型链上取），
// 而 `fromCordis(...)` 也是继承，不能同时继承。所以「装上游」在这里，「接 wire」在
// `server/workspace-files-endpoint.service.ts`。
import { WorkspaceFilesPlugin } from "./workspace-files.face.ts";
import { SessionStore } from "@morlay/dsh-session";
import { FileSystem } from "@morlay/dsh-fs";
import { SandboxPolicy } from "@morlay/dsh-sandbox";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Typert } from "@morlay/zephyr-app";

/** 上游 `WorkspaceFiles` 里本仓要转发的成员（形状直接取上游，签名不另抄）。 */
export type WorkspaceFilesFace = Pick<
  WorkspaceFilesPlugin,
  "read" | "readBytes" | "stat" | "list" | "changes"
>;

/**
 * `kFace` 在上游适配面里的类型是 `unknown`：按**运行时**校验收窄（同 `directory-picker`）。
 * @param value - 适配行挂载后拿到的上游实例。
 * @returns 五个方法齐备时是真。
 */
export function isWorkspaceFilesFace(value: unknown): value is WorkspaceFilesFace {
  return (
    value !== null &&
    typeof value === "object" &&
    ["read", "readBytes", "stat", "list", "search", "changes"].every(
      (name) => name in value && typeof (value as Record<string, unknown>)[name] === "function",
    )
  );
}

/**
 * `remote.workspaceFiles` 的上游宿主服务。
 *
 * 适配行**发布的是上游实例**：`inject(WorkspaceFilesDefault)` 拿到的就是 `WorkspaceFiles`
 * （它挂上来的那一面），wire 端点行因此直接调五个方法。
 */
@Injectable()
export class WorkspaceFilesDefault extends fromCordis(WorkspaceFilesPlugin) {
  private readonly fs = inject(FileSystem);

  private readonly sandboxPolicy = inject(SandboxPolicy);

  private readonly sessions = inject(SessionStore);

  private readonly typert = inject(Typert);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      fs: this.fs,
      sandboxPolicy: this.sandboxPolicy,
      sessions: this.sessions,
      typert: this.typert,
    });
  }
}

export type { WorkspaceByteRange, WorkspaceFileWatchFrame } from "./workspace-files.face.ts";
