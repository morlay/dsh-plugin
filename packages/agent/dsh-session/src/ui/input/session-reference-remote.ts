// 客户端 `remote.sessionReferenceResolver` 的绑定：`@` 菜单的**会话候选** namespace。
//
// 与 `@morlay/zephyr-app/client` 的 `SessionRemoteBinding` 同一职责（把一份 `TYPERT_REMOTE` descriptor
// 挂到 `remote` 上），只是这份 descriptor 属于 `@deepseek-ai/dsh-session-reference`，
// 不在 `dsh-api-session-controller` 的那一份里。少了本行，`ui-reference` 的
// `ctx.remote.sessionReferenceResolver.candidates(...)` 读到的就是 `undefined`。
import { TYPERT_REMOTE } from "@deepseek-ai/dsh-session-reference/remote";
import { inject, Injectable, type OnInit } from "@morlay/zephyr";
import { Remote } from "@morlay/zephyr-app/client";

@Injectable()
export class SessionReferenceRemoteBinding implements OnInit {
  private readonly remote = inject(Remote);

  async onInit(): Promise<void> {
    try {
      await this.remote.$mount(TYPERT_REMOTE);
    } catch (error) {
      // 挂不上就显式失败：静默会让 `@` 菜单退化成「会话候选永远为空」。
      throw new Error(`挂载 remote 绑定失败：${(error as Error).message}`, { cause: error });
    }
  }
}
