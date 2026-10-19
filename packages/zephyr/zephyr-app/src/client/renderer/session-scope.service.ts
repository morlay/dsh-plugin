// `session` / `session-maybe` 的 scope adapter：layout 的 main/sidebar 子树会渲染这个 scope，
// 缺了它渲染直接抛 `SlotAssemblyError`。真正有会话数据的那行（上游 `ui-session`）不在本链里，
// 这里装的是**空投影**：`session-maybe` 语义就是「可能没有会话」，空投影正是它的合法形态。
import type { SlotScopeAdapter, StandardSourceBinding } from "@deepseek-ai/dsh-client-ui-renderer/client";
import { inject, Injectable, type OnInit } from "@morlay/zephyr";
import { Slots } from "./slots.contract.ts";

/** 无会话：标准源全空，绑定不带 scope key。 */
export function absentSessionAdapter(): SlotScopeAdapter {
  const binding: StandardSourceBinding = { key: undefined, hooks: {}, keyedHooks: {}, props: {} };
  const source = { getSnapshot: () => binding, subscribe: () => () => {} };
  return { current: source, bindingSource: () => source };
}

@Injectable()
export class SessionScopeDefault implements OnInit {
  private readonly slots = inject(Slots);

  onInit(): void {
    this.slots.installScope("session", absentSessionAdapter());
    // layout / sidebar 的组件会读这两个 root 标准 seat（`useSessions` / `useSessionStatus`）。
    // 本链没有上游 `ui-session` 行，这里给空投影：列表空、状态表空。
    this.slots.provideRoot({
      hooks: {
        sessions: { getSnapshot: () => ({ byId: {}, allIds: [] }), subscribe: () => () => {} },
        sessionStatus: { getSnapshot: () => new Map(), subscribe: () => () => {} },
      },
    });
  }
}
