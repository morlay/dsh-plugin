# @morlay/dsh-plan-mode

计划模式：把「先出计划再动手」变成可开关的会话状态与一段系统提示词。

## 用法

- 导出：`PlanMode` 契约与 `PlanModeDefault`、`ToolTodo`（`todo_write` 工具行）。
- 装配：`PlanModeModule`（计划模式 + 待办工具行；待办只依赖会话投影，不属于任何任务域）。

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)。
