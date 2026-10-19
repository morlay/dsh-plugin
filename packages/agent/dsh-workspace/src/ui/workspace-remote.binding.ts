// `remote.workspace` 的客户端绑定：把 workspace-controller 的 **client stub** 挂到 remote 面。
//
// 放在应用层而不是框架包：框架（`zephyr-app`）不该知道业务 namespace 有哪些；
// 应用装配决定「这一页用哪几组 remote」，逐组 `$mount`。
import { TYPERT_REMOTE } from "@deepseek-ai/dsh-api-workspace-controller/remote";
import { inject, Injectable, type OnInit } from "@morlay/zephyr";
import { Remote } from "@morlay/zephyr-app/client";

@Injectable()
export class WorkspaceRemoteBinding implements OnInit {
  private readonly remote = inject(Remote);

  async onInit(): Promise<void> {
    try {
      await this.remote.$mount(TYPERT_REMOTE);
    } catch (error) {
      throw new Error(`挂载 remote.workspace 失败：${(error as Error).message}`, { cause: error });
    }
  }
}
