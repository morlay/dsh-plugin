// 视图从位置渲染那里拿到的 props：会话身份与可选的会话状态读面。
//
// 只声明本包真正用到的那几个（位置渲染会带更多，用不到的不列）。
export interface SessionModeViewProps {
  readonly sessionId?: string | undefined;
  // 上游 `ui-conversation` 的会话状态读面（`useSessions(selector)`）：面板用它跟模式变化。
  readonly useSessions?:
    | ((
        selector: (state: {
          byId: Record<string, { projectionValues?: Record<string, unknown> }>;
        }) => unknown,
      ) => unknown)
    | undefined;
}

// 从 `this.viewProps`（`unknown`）里读出本包的 props。
export function viewPropsOf(value: unknown): SessionModeViewProps {
  return (typeof value === "object" && value !== null ? value : {}) as SessionModeViewProps;
}
