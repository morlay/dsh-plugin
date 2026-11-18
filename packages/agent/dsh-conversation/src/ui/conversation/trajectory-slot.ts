// 会话里的轨迹视图（上游 `ui-trajectory`）。
import * as UiTrajectoryPlugin from "@deepseek-ai/dsh-client-ui-trajectory/client";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { Locale, Remote, Slots } from "@morlay/zephyr-app/client";
import { SessionController } from "@morlay/dsh-conversation/contract";
import { UiSession } from "../ui-session.token.ts";
import { UiConversation } from "./conversation.token.ts";
import { remoteNamespaceKey } from "@morlay/zephyr-app/client/remote";
import { remoteGroupNameOf } from "@morlay/zephyr-app/remote";
import { ToolResultsEndpoint } from "../../endpoint/tool-results.group.ts";

/**
 * `toolResults` 的 wire 组名：home 是契约类上的 `@RemoteGroup({ name })`。
 * @returns 组名。
 * @throws 契约类漏了装饰器（装配期就该发现，而不是把空组名塞进 deps）。
 */
function toolResultsGroup(): string {
  const group = remoteGroupNameOf(ToolResultsEndpoint);
  if (group === undefined) throw new Error("ToolResultsEndpoint 没有 @RemoteGroup：组名取不到");
  return group;
}

@Injectable()
export class TrajectorySlot extends fromCordis(UiTrajectoryPlugin) {
  private readonly slots = inject(Slots);

  private readonly sessions = inject(SessionController);

  private readonly uiSession = inject(UiSession);

  private readonly uiConversation = inject(UiConversation);

  private readonly locale = inject(Locale);

  private readonly remote = inject(Remote);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, undefined, {
      slots: this.slots,
      sessions: this.sessions,
      uiSession: this.uiSession,
      uiConversation: this.uiConversation,
      locale: this.locale,
      remote: this.remote,
      // 带点的名字按**字面键**给出（同 `chat-slots` 的「会话组」）。组名从契约类读（`@RemoteGroup` 的实参），
      // 不在调用点写字符串；契约类上没装饰器时当场抛，而不是塞一个空组名进 deps。
      [remoteNamespaceKey(toolResultsGroup())]: this.remote,
    });
  }
}
