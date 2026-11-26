// 会话域的行：`ui-session`（会话选中/状态/绑定的对外面 `ctx.uiSession`）。
import * as UiSessionPlugin from "@deepseek-ai/dsh-client-ui-session/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { SessionController } from "@morlay/dsh-conversation/contract";
import { Remote, RemoteAccess, Slots } from "@morlay/zephyr-app/client";
import { UiSession } from "./ui-session.token.ts";

@Injectable()
export class SessionLayout extends fromCordis(UiSession, UiSessionPlugin) {
  private readonly sessions = inject(SessionController);

  private readonly remoteAccess = inject(RemoteAccess);

  private readonly slots = inject(Slots);

  private readonly remote = inject(Remote);

  override async onInit(ctx: Context): Promise<void> {
    // 上游 `apply` 读 `ctx.sessions` / `ctx.remoteAccess` / `ctx.slots`（+ `inject` 声明的 `remote`）：
    // 全部按 deps 交进去（`fromCordis` 的读面替换）。
    try {
      // **显式全给**：上游 `inject = ['sessions', 'slots', 'remoteAccess']`（`ui-session/src/client/index.ts:620`），
      // 它的 `apply` 第一行就是 `new UiSession(ctx, ctx.sessions)`，随后 `ctx.slots.installScope('session', …)`。
      //
      // 以前这里只交 `remoteAccess`，其余「靠 store 名字满足」——但我们的令牌名是 `session-controller`，
      // 上游要的是 `sessions`：**名字对不上 → `ctx.sessions` 是 undefined → `apply` 第一行就抛 →**
      // **整段不执行（含 `installScope`），且静默**。症状是 `scope('session')` 空、右栏永远没有 panel。
      //
      // 「不交 deps 是为了让子服务拿到真 ctx」这条旧理由不成立：`mount` 内部本来就用 `withDeps` 包了
      // `upstreamCtx`（真 ctx），交 deps 只替换**按名字读**的那一层。同目录的 `SessionStatusSlots`
      // 早就把 `remote` / `sessions` / `remoteAccess` 显式交了，工作正常。
      await this.mount(ctx, undefined, {
        remoteAccess: this.remoteAccess,
        sessions: this.sessions,
        slots: this.slots,
        remote: this.remote,
      });
    } catch (error) {
      // 带阶段的错误：不然上游 `apply` 里的失败会被错误边界吞成空白页。
      throw new Error(`SessionLayout.mount 失败：${(error as Error).message}`, { cause: error });
    }
  }
}
