# 重放经 agent 驱动而非直接 append 回复

状态：已采纳

背景：edit / retry / reroll 的重放要产出**模型生成**的回复，并且不能绕过 agent 的轮次状态机；而
`@deepseek-ai/dsh-agent` 是上游包（不可修改），在纯持久化环境（无 agent-loop）里 `agents` 服务不存在。

**决定**

重放输入经 `agents` 服务驱动（duck-typed 接口，不硬依赖 `@deepseek-ai/dsh-agent`）：live agent 直接
`followup` 排队（不重建、不换 id）；cold 会话先 `resume` 已持久化会话（`create` 对已持久化日志必失败），
resume 后 agent 驻留（不 dispose，避免 session 被移出 store 破坏客户端窗口）。模型 provider / model 在
**rewind 之前**从 `request/header` 解析（就地编辑可能截断掉 header，编辑第一轮 boundary = −1 时尤甚）。

**考虑过的选项**

- **直接 append 手工构造的 assistant 回复**：回复内容由代码构造而非模型生成，无法真正「重新生成」；且
  绕过 agent 的轮次状态机。
- **硬依赖 `@deepseek-ai/dsh-agent`**：上游包不可修改，且 agents 服务在纯持久化环境中不存在。

**后果**

- `agents` 缺失时退化为「已 durable 的就地版本」（可随时 resume 续跑）；resume 失败是 rewind 前的硬错误。
- 现状与完整语义见 [设计 20260917-编排层操作语义](../designs/20260917-编排层操作语义.md) 的「agent 驱
  动」。
