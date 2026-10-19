# @morlay/dsh-deepseek-feedback

把会话日志按 DeepSeek 反馈渠道上报，并附 `/feedback` 命令入口。

## 用法

- 导出：无契约（两行）。
- 装配：`CommandFeedbackModule`（命令）与 `SessionLogDeepseekModule`（日志上报）。

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)。
