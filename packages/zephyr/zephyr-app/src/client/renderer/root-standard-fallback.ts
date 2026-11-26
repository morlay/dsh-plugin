// 通用 root 标准源的**最小 absent**：`sessions` / `sessionStatus` 两个 hook 恒为空。
//
// 名字来自上游 `ui-layout/src/client/AppFrame.tsx:307` 的硬编码（它无条件读 `useSessions` /
// `useSessionStatus`）——**不是框架的业务词汇**：框架不认识「会话」，只是必须让 AppFrame 渲染时不崩。
// 真实装配由业务行（`provideSessionShell()` 等）覆盖。
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
