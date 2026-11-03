# @morlay/session-rdb

会话持久化与分支回退的 RDB 后端（SQLite / PostgreSQL）：提供 `ctx.sessionPersistence`（上游 `SessionHandle`
模型：`create` / `open` / `flush` / `stat` / `list`）与 `ctx.sessionBranch`（`rewind` / `retry` / `fork` 的
provider 面），并接管 `ctx.sessionQuery`（全文检索 disabled）、`ctx.sessionProjectionCache`
（投影 checkpoint 落行级表）与 `$DSH_HOME/storages` 的**所有域**（workspace / schedule / cua 的授权域…）：
按 `(域, 表, 键)` 落同一张 `t_storage_records`（`rdb` KV 后端），新增域不需要再加表或映射。

## 用法

配置就是这一行的 config（聚合层 `@morlay/better-session` 的 `session-rdb` 行、profile patch，或设置页改的
那份 entry config）：

```yaml
- id: session-rdb
  name: "@morlay/session-rdb"
  config:
    type: sqlite
    path: /absolute/path/to/sessions.sqlite # 自定义路径请用绝对路径；省略则由 bundle patch 的默认值兜底
    journalMode: wal
    busyTimeout: 5000
    preparedSessionCacheSize: 1 # 冷会话观察缓存容量（条数，最小 1）
```

PostgreSQL 同理：`type: postgres` + `connectionString`（可加 `schema`，默认 `public`）。字段、默认值、装配默认值的
来源与「改配置由 Loader 重挂这一行生效」见[设计总览](./.agents/designs/20260917-设计总览.md)的「配置门面」。

PG 的方言能力（连接、`PRAGMA` 库身份、聚合的 int8、JSON 提取、本地日、事务串行）由 `@morlay/rdbkit` 自己的
`pg.spec.ts` 等用例验证；本包的契约与接管用例只在 SQLite 上跑（两个方言共用同一个后端实现，同一份逻辑不重复测）。
本地跑 rdbkit 的 PG 用例时用它的 dev 实例起库（`just pg up`，端口 25433），再设
`TEST_PG_URL=postgres://postgres:postgres@localhost:25433/postgres`。

`preparedSessionCacheSize` 透传给上游 `session-query` 的冷会话观察缓存：缓存**按条目数**持有完整 `Session`
（含整份 append-only log），被活跃观察租约钉住的条目不淘汰；一次读取中途转成 live 时会重试 live 路径，但不会
顺手清掉已缓存的 cold 条目——同一个 id 因此可能同时有两份 log 驻留。上游默认 5，**本行默认 1**（本地单用户、
rdb 后端，冷读复用的收益不值这份内存放大）；上游校验下限是 1，不能设 0。

管理面的 HTTP 通道统一挂在 `/api/morlay/v1/session` 前缀下（均为 `POST`，body `{ sessionId }` 或列表请求
`{ query?, includeSubagents?, page?, pageSize? }`）：`/rows`（完整语料，含归档）、`/export`、`/import`、
`/delete`、`/gc`、`/usage`（前缀与上游分家的理由见
[ADR-管理面HTTP路由前缀与上游分家](./.agents/adrs/20260929-管理面HTTP路由前缀与上游分家.md)）。旧
`$DSH_HOME/storages` JSON 的导入是包内 API `importStorages`（`src/import-storages.ts`，不在包出口里）。

## 与数据库的交互

**本包不写 SQL**：所有查询、写入、结构与迁移都经 `@morlay/rdbkit` 的表句柄与表达式（`E.eq` / `E.coalesce` /
`E.localDay` / `E.jsonInt` …）；方言相关的渲染落在 rdbkit 里，本包只表达语义。连接、事务、库身份（`PRAGMA`）、
`VACUUM` 同样由 rdbkit 提供入口，本包看不到驱动与方言。

SQLite 与 PostgreSQL 共用同一个后端实现 `src/backend-rdb.ts`（`RdbBackend`）：读模型、写事务、统计与域存储
都只有一份代码，方言差异只出现在表达式层（[设计 数据库交互经 rdbkit](./.agents/designs/20261103-数据库交互经-rdbkit.md)）。
