# @morlay/dsh-job

后台任务注册表：长跑动作在此登记、查询与取消，工具调用之外也有统一出口。

## 用法

- 导出：`Jobs` 契约与 `JobsDefault`、`ToolJobs`（`job_list` / `job_output` / `job_kill` 工具行）。
- 装配：`JobModule`（注册表 + 后台任务工具行）。

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)。
