# @morlay/dsh-tool-policy

工具调用生命周期上的四条策略：重复调用提醒、超时、图片外置、MCP 资源注入。

## 用法

- 导出：无契约（契约面是 `@morlay/dsh-agent` 的 `Tools`）。
- 装配：`ToolPolicyModule`。

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)。
