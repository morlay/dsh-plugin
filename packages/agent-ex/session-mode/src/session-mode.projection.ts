// 会话模式的两个投影：选择（`sessionMode`）与「还能不能换」（`sessionModeEditable`）。
// 都是纯 fold 的数据对象，注册走注入进来的会话投影服务。
//
// 两份都带 `wire`：客户端（`useSessions` 的 `projectionValues`）按它读会话事实。上游的 `SessionProjectionMap`
// 是可合并的，但本仓规范禁止给上游类型加成员（`.agents/standards/how-to-write.md`「禁止模块增强」），
// 所以键的类型在注册那一处断言一次——运行期只读 `wire.view` / `wire.viewSchema`，与类型表无关。
import type { Session } from "@morlay/dsh-session/contract";
import { z } from "zod";

// fold 只读事件类型与数据：上游 `SessionEvent` 的判别联合不认这条插件事件，这里按宽形状读。
interface PluginEvent {
  readonly type: string;
  readonly data: unknown;
}

// 本行落的会话事实：模式是在空白窗口里选的。
export const SESSION_MODE_SELECTED = "session-mode/selected";

export const sessionModeProjection = {
  key: "sessionMode",
  stateSchema: z.union([z.string(), z.null()]),
  init: () => null as string | null,
  apply: (state: string | null, event: PluginEvent): string | null => {
    if (event.type !== SESSION_MODE_SELECTED) return state;
    const next = (event.data as { readonly sessionMode?: unknown } | undefined)?.sessionMode;
    return typeof next === "string" ? next : state;
  },
  wire: {
    viewSchema: z.union([z.string(), z.null()]),
    view: (state: string | null) => state,
  },
  stateVersion: 1,
};

// 这个会话挂着哪份 agent preset。
//
// 本部署只装 ptc 那一份行清单，没有官方 roster 的多 preset 选择面：值取自会话 header（恢复 / fork 时带过来的
// 那一份），没有就是部署的那一个 id。上游 `@deepseek-ai/dsh-agent-preset-registry` 的同名单元做的就是这件事，
// 我们不引那个包（它整套是给多 preset 选择面用的）。
export function agentPresetProjection(defaultPreset: string) {
  return {
    key: "agentPreset",
    stateSchema: z.union([z.string(), z.null()]),
    init: (header: { readonly agentPreset?: string }) => header.agentPreset ?? defaultPreset,
    apply: (state: string | null) => state,
    wire: {
      viewSchema: z.union([z.string(), z.null()]),
      view: (state: string | null) => state,
    },
    stateVersion: 1,
  };
}

// 这个会话还能不能换模式：空白会话为 `true`，`turn/start` 一落库就永远 `false`。
export const sessionModeEditableProjection = {
  key: "sessionModeEditable",
  stateSchema: z.boolean(),
  init: () => true,
  apply: (state: boolean, event: PluginEvent): boolean => state && event.type !== "turn/start",
  wire: { viewSchema: z.boolean(), view: (state: boolean) => state },
  stateVersion: 1,
};

// 往会话日志写一条选择事件：上游 `append` 的类型表不认这个类型，边界在这里断言一次。
export function appendSelected(session: Session, mode: string): void {
  (session.append as (type: string, data: unknown) => unknown)(SESSION_MODE_SELECTED, {
    sessionMode: mode,
  });
}
