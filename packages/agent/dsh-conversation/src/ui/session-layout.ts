// 会话域的行：`ui-session`（会话选中/状态/绑定的对外面 `ctx.uiSession`）。
import * as UiSessionPlugin from "@deepseek-ai/dsh-client-ui-session/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { SessionController } from "@morlay/dsh-conversation/contract";
import { Remote, RemoteAccess, SessionRemoteBinding, Slots } from "@morlay/zephyr-app/client";
import { UiSession } from "./ui-session.token.ts";

@Injectable()
export class SessionLayout extends fromCordis(UiSession, UiSessionPlugin) {
  private readonly sessionRemoteBinding = inject(SessionRemoteBinding);

  private readonly sessions = inject(SessionController);

  private readonly remoteAccess = inject(RemoteAccess);

  private readonly slots = inject(Slots);

  private readonly remote = inject(Remote);

  override async onInit(ctx: Context): Promise<void> {
    // 上游 `apply` 读 `ctx.sessions` / `ctx.remoteAccess` / `ctx.slots`（+ `inject` 声明的 `remote`）：
    // 全部按 deps 交进去（`fromCordis` 的读面替换）。
    try {
      // **不交 deps**：上游 `ui-session` 会把子服务 `uiSession.sessionStatus` 挂到实例上，那一步要求
      // 实例的 ctx 是**真 ctx**（deps 代理会让子服务名在代理之外解析，读它时抛
      // `cannot get property "uiSession.sessionStatus" without inject`）。它要的四个名字
      // （`sessions` / `slots` / `remote` / `remoteAccess`）都在 store 里，靠名字满足即可。
      await this.mount(ctx);
    } catch (error) {
      // 带阶段的错误：不然上游 `apply` 里的失败会被错误边界吞成空白页。
      throw new Error(`SessionLayout.mount 失败：${(error as Error).message}`, { cause: error });
    }
  }
}
