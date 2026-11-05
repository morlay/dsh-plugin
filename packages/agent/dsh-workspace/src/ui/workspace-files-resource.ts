// `file` 资源协议的 provider（上游 `api/workspace-files` 的 client 半）。
//
// 文件预览读的是 `dsh-resource://file/session/<id>/<path>`，`useResource('file')` 走 `ctx.resources`——
// 没有这个 provider，`status` 就是 `'none'`，界面显示「文件资源服务不可用」。
// 它按 「工作区文件组」 的 `stat` + `changes` 流算版本，所以要排在挂了那份 remote 的行之后。
import * as UiWorkspaceFilesPlugin from "@deepseek-ai/dsh-api-workspace-files/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Remote, Resources } from "@morlay/zephyr-app/client";
import { WORKSPACE_FILES_REMOTE_KEY } from "../endpoint/index.ts";

@Injectable()
export class WorkspaceFilesResource extends fromCordis(UiWorkspaceFilesPlugin) {
  private readonly resources = inject(Resources);

  private readonly remote = inject(Remote);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      resources: this.resources,
      remote: this.remote,
      // 带点的名字按字面键给（`withDeps` 只按 `Object.hasOwn` 替换）。
      [WORKSPACE_FILES_REMOTE_KEY]: this.remote,
    });
  }
}
