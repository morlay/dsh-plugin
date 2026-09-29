# 不声明 toolUpdate：请求按完整工具表声明

状态：已采纳

背景：`dsh-llm` 有动态工具更新这条面：`LlmResolvedModelInfo.toolUpdate`
（`'in-history' | 'addition-only'`）、`GenerateOptions.toolHistory`、`ToolSchema.deferLoading`，agent-loop
在工具集变化时写 `developer/message`（tool-addition / tool-removal）。runtime 在分发边界按该声明投影`LlmResolvedModelInfo.toolUpdate`（`'in-history' | 'addition-only'`）、
`GenerateOptions.toolHistory`、`ToolSchema.deferLoading`，agent-loop 在工具集变化时写
`developer/message`（tool-addition / tool-removal）。runtime 在分发边界按该声明投影
（`vendor/deepseek-harness/packages/llm/llm/src/index.ts:1075-1086`）：**未声明**的 route 会被剥掉全部 developer 消息
与 tools 上的 `deferLoading`，等于每次请求声明完整当前工具表。

**决定**

本包 `resolveModel` 不声明 `toolUpdate`。chat-completions wire 只有 plain function tools，
表达不了「延迟声明 + 会话中增减」；缺省的「每次请求完整工具表」正是该协议的语义。

**考虑过的选项**

- **声明 `'addition-only'`**：本包 [serialize.ts](../../src/serialize.ts) 对 developer 消息与 tool-change 块直接抛
  `UNSUPPORTED_CONTENT`（:233-248），声明即把这两条抛错变成真实路径——工具集一变就打挂请求。
- **照 llm-deepseek 做 per-model opt-in 并补齐序列化**：那套 wire（`tool_addition` / `tool_removal` +
  `defer_loading` + beta 头 `mid-conversation-tool-changes-2026-07-01`）是 DeepSeek Messages 专有，
  OpenAI 兼容侧没有对应物；等真有 provider 支持再开，届时改动是「逐模型声明 + 序列化两侧 + README/catalog」。
- **对 `deferLoading === true` 显式抛错**（对齐 llm-pi-ai）：暂缓（YAGNI）——上游未声明路线会剥掉它，当前不可达。

**后果**

- 工具集变化时 agent-loop 视为**新请求序列**：system prompt 头重写 + 全量工具表重发，缓存前缀随之失效；
  这是当前行为，也是该协议下不可避免的代价。
- developer 消息仍写进会话日志（只在分发前被剥掉）：UI 与压缩能看到，本包不消费。
- 若上游把「未声明」的兜底从剥离改成报错，本包会以 `UNSUPPORTED_CONTENT` 失败——关注项。
