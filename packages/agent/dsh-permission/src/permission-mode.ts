// 权限档位：一个档位同时写沙箱模式与批准策略两个开关（契约类型住包根，server 面的装配函数引用它）。
import { PresetSpec } from "@deepseek-ai/dsh-permission-presets";

/** 权限档位：一个档位同时写沙箱模式与批准策略两个开关。 */
export type PermissionMode = PresetSpec["sandbox"];

// 三个档位与它们的开关组合：**一份表**同时供「预设表」与「批准默认策略」用，
// 免得两处各写一遍 `danger-full-access ⇒ never`。
export const PERMISSION_PRESETS: Record<PermissionMode, PresetSpec> = {
  "read-only": { sandbox: "read-only", approval: "ask" },
  "workspace-write": { sandbox: "workspace-write", approval: "ask" },
  "danger-full-access": { sandbox: "danger-full-access", approval: "never" },
};
