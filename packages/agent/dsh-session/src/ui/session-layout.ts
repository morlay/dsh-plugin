// 会话域的行：`ui-session`（会话选中/状态/绑定的对外面 `ctx.uiSession`）。
import * as UiSessionPlugin from "@deepseek-ai/dsh-client-ui-session/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { SessionController } from "./session-controller.contract.ts";
import { Remote, RemoteAccess, SessionRemoteBinding, Slots } from "@morlay/zephyr-app/client";
import { UiSession } from "./ui-session.token.ts";

@Injectable()
export class SessionLayout extends fromCordis(UiSession, UiSessionPlugin) {
  private readonly sessionRemoteBinding = inject(SessionRemoteBinding);

  private readonly sessions = inject(SessionController);

  private readonly remoteAccess = inject(RemoteAccess);

  private readonly slots = inject(Slots);

  private readonly remote = inject(Remote);

  protected override async onInit(ctx: Context): Promise<void> {
    // 上游 `apply` 读 `ctx.sessions` / `ctx.remoteAccess` / `ctx.slots`（+ `inject` 声明的 `remote`）：
    // 全部按 deps 交进去（`fromCordis` 会写进行 ctx 的名字视图）。
    try {
      await this.mount(ctx, undefined, {
        sessions: this.sessions,
        remoteAccess: this.remoteAccess,
        slots: this.slots,
        remote: this.remote,
      });
    } catch (error) {
      // 带阶段的错误：不然上游 `apply` 里的失败会被错误边界吞成空白页。
      throw new Error(`SessionLayout.mount 失败：${(error as Error).message}`, { cause: error });
    }
  }
}
