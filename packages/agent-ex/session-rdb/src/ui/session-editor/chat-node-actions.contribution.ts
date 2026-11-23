// 消息动作的槽贡献：`conversation.chat.node` 的 `user` / `steering` 两条 keyed 注册。
//
// 用 `@Slot({})` + `slotRegistrations()`（而不是 `@SlotView`）：这两条要带 `locale` / `priority` /
// 注册级 `inject` 面，那是注册选项而不是位置声明。`priority` 取 -1：与官方内置渲染同 key 时由我们这份生效。
// 位置由上游 `ui-chat` 声明，所以每条都开 `inject`（等声明出现再注册）。
import { inject } from "@morlay/zephyr";
import { Slot, SlotContribution } from "@morlay/zephyr-app/client";
import { SessionEditorStore } from "./session-editor.store.ts";
import { UserMessageNodeView } from "./user-message.view.tsx";

// 本行替换的两个 chat-node key。
const REPLACED_KEYS = ["user", "steering"] as const;

@Slot({})
export class ChatNodeActionsContribution extends SlotContribution {
  private readonly editor = inject(SessionEditorStore);

  slotRegistrations() {
    const faceOf = (sessionId: string) => this.editor.faceOf(sessionId);
    return REPLACED_KEYS.map((key) => ({
      at: "conversation.chat.node" as const,
      options: { key, locale: "chat" as const, priority: -1, inject: faceOf },
      component: UserMessageNodeView as never,
      inject: true,
    }));
  }
}
