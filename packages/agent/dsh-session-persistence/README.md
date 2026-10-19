# @morlay/dsh-session-persistence

会话落盘：自己实现持久化（不转发上游插件），让会话在进程之外可恢复。

## 用法

- 导出：`SessionPersistence` 契约与 `SessionPersistenceDefault`。
- 装配：`SessionPersistenceModule`。

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)。
