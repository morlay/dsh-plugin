# @morlay/dsh-agent

agent 的运行时骨架：会话与 agent 的注册表、LLM 调用、系统提示词、工具注册表和 agent loop。

## 用法

- 导出：`AgentDirectory` / `Llm` / `SystemPrompt` / `ToolRegistry` / `AgentLoop` / `AgentDefaultModel` / `LaunchEnvironment` 七个契约与各自的默认实现。
- 装配：`AgentModule`（含 `TimerDefault`）；其余域从这里取契约，不复制实现。
- 域内只有一条行、没有第二个消费者的留在这里，不单开包：`TimerDefault`（令牌就是上游 `TimerService`）与 `LaunchEnvironmentDefault`（读者是上游 `launchEnvironmentOf`，目前不进模块，装配面要用时单列）。

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)。
