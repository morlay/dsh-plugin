// 「会话已读状态」的**宿主半**：上游 `SessionStatusService`（服务名 `sessionStatus`，Remote 命名空间同名）。
//
// 浏览器半（`SessionStatusSlots`）会 `$mount` 那份 descriptor 并调 `sessionStatus/follow`；
// 宿主缺这一行时 wire 上是
// `typert gateway: sessionStatus/follow: no active Remote method exports this endpoint`，
// 界面上表现为「提醒同步不了、请刷新页面重连」。
//
// 上游的 `static inject` 是 `['remoteAccess', 'sessions', 'sessionPersistence', 'typert']`：
// 四个都按下文显式交给它。
import { SessionStatusService } from "@deepseek-ai/dsh-client-ui-session-status";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { RemoteAccess, TypertGateway } from "@morlay/zephyr-app";
import { SessionStore } from "@morlay/dsh-session";
import { SessionPersistence } from "@morlay/dsh-session-persistence";

/** 会话已读状态的宿主行。 */
@Injectable()
export class SessionStatusHost extends fromCordis(SessionStatusService) {
  private readonly remoteAccess = inject(RemoteAccess);

  private readonly sessions = inject(SessionStore);

  private readonly sessionPersistence = inject(SessionPersistence);

  private readonly typert = inject(TypertGateway);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      remoteAccess: this.remoteAccess,
      sessions: this.sessions,
      sessionPersistence: this.sessionPersistence,
      typert: this.typert,
    });
  }
}
