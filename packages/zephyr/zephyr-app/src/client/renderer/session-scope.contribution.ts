// `session` / `session-maybe` 的 scope adapter：layout 的 main/sidebar 子树会渲染这个 scope，
// 缺了它渲染直接抛 `SlotAssemblyError`。真正有会话数据的那行（上游 `ui-session`）不在本链里，
// 这里装的是**空投影**：`session-maybe` 语义就是「可能没有会话」，空投影正是它的合法形态。
import type {
  RootStandardSourceContribution,
  SlotScopeAdapter,
  StandardSourceBinding,
} from "@deepseek-ai/dsh-client-ui-slots";
import { Slot, SlotContribution } from "./slot.decorator.ts";

/** 无会话：标准源全空，绑定不带 scope key。 */
export function absentSessionAdapter(): SlotScopeAdapter {
  const binding: StandardSourceBinding = { key: undefined, hooks: {}, keyedHooks: {}, props: {} };
  const source = { getSnapshot: () => binding, subscribe: () => () => {} };
  return { current: source, bindingSource: () => source };
}

/** layout / sidebar 的组件读这两个 root 标准 seat（`useSessions` / `useSessionStatus`）。 */
export const absentSessions: RootStandardSourceContribution = {
  hooks: {
    sessions: { getSnapshot: () => ({ byId: {}, allIds: [] }), subscribe: () => () => {} },
    sessionStatus: { getSnapshot: () => new Map(), subscribe: () => () => {} },
  },
};

/**
 * 兜底：没有 `ui-session` 行时提供 `session` scope 与 root 标准源，让渲染前提成立。
 * 有真实实现时（`slots.scope('session')` 已装）它**不装**，避免重装冲突。
 */
@Slot({
  scope: { session: absentSessionAdapter() },
  root: absentSessions,
})
export class SessionScopeContribution extends SlotContribution {
  override onInit(): void {
    if (this.slots.scope("session") !== undefined) return;
    super.onInit();
  }
}
