import type { SessionId } from "@deepseek-ai/dsh-session";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-ui-chat/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import { UserMessageNodeView } from "./MessageItem.tsx";
import type { SessionEditorController } from "../controller.ts";

const NS = "conversation";

interface SlotsLike {
  inject(name: string, callback: () => unknown): unknown;
  register(options: unknown, component: unknown): unknown;
}

export function registerChatNodeRenderers(
  ctx: { slots: SlotsLike },
  controllerFor: (sessionId: SessionId) => SessionEditorController,
): void {
  const injectFace = (sessionId: SessionId) => controllerFor(sessionId).face;

  for (const key of ["user", "steering"] as const) {
    ctx.slots.inject("conversation.chat.node", () =>
      ctx.slots.register(
        {
          name: "conversation.chat.node",
          key,
          locale: NS,
          priority: -1,
          inject: injectFace,
        } as never,
        UserMessageNodeView as never,
      ),
    );
  }
}
