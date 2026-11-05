# @morlay/dsh-ptc

PTC（programmatic tool calls，程序化工具调用）的运行时：「模型写一段程序、程序里调工具」这条路的执行面。

## 用法

- 导出：`PtcRuntime` 契约与 `PtcRuntimeDefault`（转发上游 `NodePtcRuntimeService`）、`ToolExecutorPtc`（转发上游 `@deepseek-ai/dsh-tool-executor-ptc`），以及装配函数 `providePtc([features])`（包根）。
- `providePtc()` 的清单三行：`PtcAgentGroup`（本域按 agent 分层的那份清单）、`PtcRuntimeDefault`、`ToolExecutorPtc`。
- 运行时行的 `deps`：`FileSystem` / `Subprocess` / `Sandbox` / `SandboxPolicy`；执行器行的 `deps`：`ToolRegistry` / `SystemPrompt` / `PtcRuntime`。
- **一个 scope 只能有一个执行器**：执行器做两件只有它能做的事——把模型面收成 `run_code` 一条、注册 `tools:ptc-only` / `tools:sdk` 两条 system section。上游 `setExecutor` 在同一 scope 上只许一个，第二个抛 `Only one tool executor may be registered in each scope`。
- 只装运行时不算「PTC 生效」：缺执行器时装配照常起来、也没有报错，只是模型面还是普通工具清单。装配级判据不在本包。

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)。

`run_code` 的模型面描述只有英文（由上游执行器自己构造，改不到），记在[债](../../../.agents/debts/20261109-run_code工具描述只有英文.md)。
