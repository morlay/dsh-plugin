# @morlay/dsh-storage

存储 hub 与 domain 契约：后端可换，消费方只认这一个面。

## 用法

- 导出：`Storage`（hub）与 `StorageDomain` 契约及默认实现。
- 装配函数：`provideStorage()`（hub 与 domain 行）与 `provideStorageJson()`（json 后端），都在包根；本包不拥有装配清单。

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)。
