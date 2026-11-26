// 通用 root 标准源的**最小 absent**：`sessions` / `sessionStatus` 两个 hook 恒为空。
//
// 名字来自上游**全局标准 props**（`GlobalStandardProps` 的模块合并），不是框架的词汇：
// - `useSessions`：`ui-session/src/client/index.ts:140` 合并，`ui-layout/src/client/AppFrame.tsx:309` 无条件读；
// - `useSessionStatus`：`ui-session-status/src/client/status.ts:36` 合并。
// 缺任何一个上游都直接抛（`ui-renderer/src/client/scoped-slots.tsx:497` 「strict standard hook has no source」），
// 所以框架只做**空投影**让 AppFrame 渲染时不崩；真实装配由业务行覆盖。
//
// 与 `renderRoot` 硬编码 `<ScopeProvider scope="session-maybe">` 是同一性质：**为上游的越界兜底**。
import type { RootStandardSourceContribution } from "@deepseek-ai/dsh-client-ui-slots";
import { Slot, SlotContribution } from "./slot.decorator.ts";

/** `AppFrame` 硬编码读的两个 root hook 的空投影（空快照 + 空数组，不造假数据）。 */
export const absentRootStandard: RootStandardSourceContribution = {
  hooks: {
    sessions: {
      getSnapshot: () => ({ byId: {}, allIds: [] }),
      subscribe: () => () => {},
    },
    sessionStatus: {
      getSnapshot: () => new Map(),
      subscribe: () => () => {},
    },
  },
};

/** 兜底行：最小装配（测试 / 新应用骨架）装上它，`AppFrame` 就能渲染。 */
@Slot({ root: absentRootStandard })
export class RootStandardFallback extends SlotContribution {}
