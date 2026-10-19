# @morlay/dsh-checkpoint-policy

会话检查点策略：按 LLM 与工具活动决定何时为会话落一次检查点。

## 用法

- 导出：无契约（纯行）。
- 装配：`SessionCheckpointPolicyModule`；它注入 agent 的 `Llm` / `Tools` 与会话的 `SessionPersistence` / `SessionStore`。

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)。
