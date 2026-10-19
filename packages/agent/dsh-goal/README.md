# @morlay/dsh-goal

目标状态机与续跑驱动：把「一个会话要反复推进的目标」变成可持久化的状态并自动续跑。

## 用法

- 导出：`Goal` 契约与 `GoalDefault`、`ToolGoal`（`get_goal` / `create_goal` / `update_goal` 工具行）。
- 装配：`GoalModule`（状态机 + 目标工具行）、`GoalRoundDriverModule`（续跑）、`CommandGoalModule`（`/goal` 命令）。

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)。
