// 命令弹层的视图：读装配进来的 `CommandPaletteStore`，渲染对应 UI。
//
// 注册由 `SlotViewBase` 完成（位置来自 `@SlotProvider` 的 `extends`），视图只写 `render()`。
//
// 为什么不直接复用上游的 `MenuView`：它的 props 绑定了上游 `InputTriggerService` 的 controller
// store（`menu: SnapshotStore<MenuState>` + pick/hover 回调），那个 controller 属于输入区触发器那一层，
// 等输入区自己的模块落地后再接。这里的 DOM 只表达「命令弹层是什么」，标记 `data-command-palette`。
import { useSyncExternalStore, type ReactNode } from "react";
import { inject } from "@morlay/zephyr";
import { SlotView } from "@morlay/zephyr-app/client";
import { CommandPaletteStore } from "@morlay/dsh-command/ui";
import { ConversationInputOverlaySlot } from "./conversation-input-overlay.slot.ts";

/** 命令弹层：把 store 的会话状态渲染成列表，选中项带标记。 */
@SlotView()
export class CommandPaletteView extends ConversationInputOverlaySlot {
  private readonly palette = inject(CommandPaletteStore);

  render(): ReactNode {
    const sessionId = (this.viewProps as { sessionId?: string } | undefined)?.sessionId;
    if (sessionId === undefined) return null;
    const state = useSyncExternalStore(
      (listener) => this.palette.subscribe(listener),
      () => this.palette.stateOf(sessionId),
    );
    if (!state.open) return null;
    const visible = this.palette.visibleOf(state);
    return (
      <div data-command-palette="">
        <ul>
          {visible.map((entry, index) => (
            <li key={entry.name} data-selected={index === state.selected ? "" : undefined}>
              {`/${entry.name}`}
              {entry.description === "" ? null : <span>{entry.description}</span>}
            </li>
          ))}
        </ul>
      </div>
    );
  }
}
