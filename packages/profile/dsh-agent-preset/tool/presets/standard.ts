import { STANDARD_PERSONA } from "./persona.ts";
import { row, scopeRow, TOOLKIT_TOOL_NAMES, type PresetRow } from "./rows.ts";

/**
 * 标准模式的清单：**只有提示词与开关**。
 *
 * 工具行在 profile 平面装一次（[`@morlay/dsh-agent-toolkit`](../../../dsh-agent-toolkit/README.md) 的 bundle
 * patch），这里用 `allowTools` 声明这个模式能用哪些——名单从 toolkit 的汉化数据派生（工具集与汉化同源），
 * 不另写一份。
 */
export const STANDARD_ROWS: readonly PresetRow[] = [
  // persona 按模式给：注册 agent 作用域的同名 section，遮蔽部署级那层。
  row("persona", { config: { ...STANDARD_PERSONA } }),
  // 本模式不吃 host 层的「先读后改」策略（上游 `fs-observation-policy` 对所有会话生效）。
  // 这不是"禁用 host 行"（preset 做不到），而是抢在它的 waterfall 前面丢弃结果——见 relax-intent 的说明。
  { id: "fs-intent-relax", name: "@morlay/dsh-agent-preset/relax-intent" },
  // 开关：工具白名单（装配期投影 + 执行层 guard，两侧同判据）+ instruction 与动态快照默认都要。
  scopeRow({ allowTools: [...TOOLKIT_TOOL_NAMES] }),
];
