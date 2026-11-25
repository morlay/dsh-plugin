// 会话界面里「未读标记」那一行：上游 `ui-session-status` 的 **client 行**。
//
// 它把子服务发布成 `uiSession.sessionStatus`（`super(ctx, 'uiSession.sessionStatus')`），下游
// `ui-workspace`（未读标记）与 `ui-sidebar` 都按 `ctx.uiSession.sessionStatus` 读。
// 装配顺序：`provideSessionShell()`（出 `uiSession`）之后、`provideWorkspaceUi()` 之前。
import * as UiSessionStatusPlugin from "@deepseek-ai/dsh-client-ui-session-status/client";
import SessionStatusRemote from "@deepseek-ai/dsh-client-ui-session-status/remote";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { remoteNamespaceKey } from "@morlay/zephyr-app/client/remote";
import { Remote, RemoteAccess, Slots } from "@morlay/zephyr-app/client";
import { UiSession, UiSessionStatus } from "@morlay/dsh-conversation/contract";
import { SessionController } from "@morlay/dsh-conversation/contract";
import { namespaceOf } from "./remote-namespace.ts";

@Injectable()
export class SessionStatusSlots extends fromCordis(UiSessionStatus, UiSessionStatusPlugin) {
  private readonly remote = inject(Remote);

  private readonly remoteAccess = inject(RemoteAccess);

  private readonly sessions = inject(SessionController);

  private readonly slots = inject(Slots);

  private readonly uiSession = inject(UiSession);

  override async onInit(ctx: Context): Promise<void> {
    // 上游 apply 里 `new SessionReadModel(ctx.remote.sessionStatus)`：这份 descriptor 要**先挂上**，
    // 否则那一面是 `undefined`，读它的 `.follow` 就抛
    // `Cannot read properties of undefined (reading 'follow')`（前端表现是"提醒同步不了"）。
    const dispose = await this.remote.$mount(SessionStatusRemote);
    ctx.effect(() => dispose);
    const remote = this.remote;
    await this.mount(ctx, undefined, {
      remote,
      // 带点的名字按**字面键**给出（`fromCordis` 的 deps 校验逐字匹配）。
      [remoteNamespaceKey("sessionStatus")]: namespaceOf(remote, "sessionStatus"),
      remoteAccess: this.remoteAccess,
      sessions: this.sessions,
      slots: this.slots,
      uiSession: this.uiSession,
    });
  }
}
