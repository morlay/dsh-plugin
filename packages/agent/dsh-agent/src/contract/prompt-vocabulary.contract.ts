// 提示词装配的**运行时词汇**（上游 `@deepseek-ai/dsh-system-prompt`）：装配入口与两件纯渲染函数。
//
// 测试要按同一口径装配、按同一渲染器出快照，所以它们是能力词汇而不是测试私货。
export { assembleContextFor } from "@deepseek-ai/dsh-agent";
export { renderContextSnapshot, renderPrompt } from "@deepseek-ai/dsh-system-prompt";
