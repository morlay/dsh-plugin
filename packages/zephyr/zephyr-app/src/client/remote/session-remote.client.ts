// 客户端侧的 remote 绑定：把 `session` namespace 的 **client stub** 挂到 gateway。
//
// 与服务端 `SessionController` 的 `bindTypertRemote` 对称：那边注册 host 绑定、这边注册 client 绑定，
// 中间靠 `api-gateway` 的 HTTP 通道（`/api/remote.mux`）连起来。
import { TYPERT_REMOTE } from "@deepseek-ai/dsh-api-session-controller/remote";
import { inject, Injectable, type OnInit } from "@morlay/zephyr";
import { Remote } from "../../remote/remote.contract.ts";

@Injectable()
export class SessionRemoteBinding implements OnInit {
  private readonly remote = inject(Remote);

  async onInit(): Promise<void> {
    // `$mount` 返回 disposer；本行没有卸载场景，忽略即可。
    // 失败要显式报出来（之前 `void` 会把 rejection 吞掉，导致「没挂上也没提示」）。
    try {
      await this.remote.$mount(TYPERT_REMOTE);
    } catch (error) {
      throw new Error(`挂载 remote 绑定失败：${(error as Error).message}`, { cause: error });
    }
  }
}
