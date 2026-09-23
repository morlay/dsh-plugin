/**
 * 本包只留**提示词与能力开关**：
 *
 * - 提示词：`persona` 行（各模式自己的 `persona.ts`）；
 * - 开关：[`@morlay/dsh-context-assembler/rows`](../../../context/dsh-context-assembler/src/rows.ts) 的 `scopeRow`
 *   （工具白名单 / instruction 总开关 / 动态快照开关）；
 * - 工具集名单：从 [`@morlay/dsh-agent-toolkit/rows`](../../../dsh-agent-toolkit/src/rows.ts) 派生
 *   （与汉化同源），用来给 `allowTools` 白名单。
 *
 * 工具行与注入通道都不在这里：它们由各自的 bundle 在 profile 平面装一次（`dsh.profile.bundles`），
 * 模式只声明"我要哪些"。
 */
export { row, TOOLKIT_TOOL_NAMES, type PresetRow, type RowExtra } from "@morlay/dsh-agent-toolkit/rows";
export { scopeRow } from "@morlay/dsh-context-assembler/rows";
