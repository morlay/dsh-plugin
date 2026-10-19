# @morlay/dsh-session

会话核心：存储、投影、查询、token 计量与浏览器侧会话数据面；标题、检查点等子域在各自包里。

## 用法

- 导出：`SessionStore` / `SessionProjections` / `SessionQuery` / `SessionProjectionCache` / `TokenMeter` / `Sessions` 等契约与默认实现。
  持久化的契约与实现**不在本包**：用 `@morlay/dsh-session-persistence`（根入口是模块与默认实现，`/contract` 是契约）。
- 装配：`SessionModule`、`SessionProjectionModule`、`SessionProjectionCacheModule`、`SessionQuerySqliteModule`、`TokenMeterModule`；浏览器半装 `@morlay/dsh-session/ui` 的 `SessionsStoreModule` / `SessionsModule`。

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)。
