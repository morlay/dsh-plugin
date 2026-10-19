# @morlay/dsh-persistence

存储的 json 后端行：给存储 hub 注册一个文件后端，让数据落盘而不绑死实现。

## 用法

- 导出：无契约（令牌就是这个后端适配类自身；契约在 `@morlay/dsh-storage`）。
- 装配：`PersistenceModule`，存储根目录由装配面显式给。

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)。
