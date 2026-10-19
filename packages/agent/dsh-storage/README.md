# @morlay/dsh-storage

存储 hub 与 domain 契约：后端可换，消费方只认这一个面。

## 用法

- 导出：`Storage`（hub）与 `StorageDomain` 契约及默认实现。
- 装配：`StorageModule`；具体后端另装（json 后端在 `@morlay/dsh-persistence`）。

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)。
