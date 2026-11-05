# @morlay/dsh-compaction

上下文压缩：判定何时压、压成什么形状，并附 `/compact` 命令入口。

## 用法

- 导出：`Compaction` 契约与 `CompactionBasic` 行。
- 装配：`CompactionBasicModule`（压缩本身）与 `CommandCompactModule`（命令入口）。

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)。
