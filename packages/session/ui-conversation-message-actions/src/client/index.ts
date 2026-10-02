import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-ui-chat/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type { SessionId } from "@deepseek-ai/dsh-session";
import { SessionEditorController } from "./controller.ts";
import { registerChatNodeRenderers } from "./chat-node/register.ts";
import { registerComposerStats } from "./composer-stats/register.ts";
import { apply as installUiPrimitives } from "@morlay/dsh-client-ui-primitives/client";

export const inject = ["slots", "conversation", "connection", "sessions", "uiWorkspace"];

export function apply(ctx: Context): void {
  // 基础面随本包 inline（不再是装配行）：装上它提供的字典、字段槽与按行配置页；多份副本只装一次。
  installUiPrimitives(ctx);

  const controllers = new Map<SessionId, SessionEditorController>();
  const controllerFor = (sessionId: SessionId): SessionEditorController => {
    let controller = controllers.get(sessionId);
    if (controller === undefined) {
      controller = new SessionEditorController(ctx, sessionId);
      controllers.set(sessionId, controller);
    }
    return controller;
  };

  registerChatNodeRenderers(ctx, controllerFor);

  ctx.slots.inject("conversation.composer.dock", () => registerComposerStats(ctx.slots));
}
