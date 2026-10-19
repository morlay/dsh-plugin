import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-ui-chat/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
import type { SessionId } from "@deepseek-ai/dsh-session";
import { Sessions } from "@morlay/dsh-web-app/session/client/tokens";
import { Slots } from "@morlay/dsh-web-app/renderer/client/tokens";
import { Injectable, inject } from "@morlay/zephyr";
import { registerChatNodeRenderers } from "./chat-node/register.ts";
import { SessionEditorController } from "./controller.ts";

@Injectable()
export class MessageActions {
  slots = inject(Slots);

  sessions = inject(Sessions);

  onInit(): void {
    const controllers = new Map<SessionId, SessionEditorController>();
    const controllerFor = (sessionId: SessionId): SessionEditorController => {
      let controller = controllers.get(sessionId);
      if (controller === undefined) {
        controller = new SessionEditorController(this.sessions, sessionId);
        controllers.set(sessionId, controller);
      }
      return controller;
    };

    registerChatNodeRenderers({ slots: this.slots }, controllerFor);
  }
}
