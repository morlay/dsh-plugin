# @morlay/session-rdb

会话持久化与分支回退的 RDB 后端（SQLite / PostgreSQL）：提供 `ctx.sessionPersistence`（上游 `SessionHandle`
模型：`create` / `open` / `flush` / `stat` / `list`）与 `ctx.sessionBranch`（`rewind` / `retry` / `fork` 的
provider 面），并接管 `ctx.sessionQuery`（全文检索 disabled）与 `$DSH_HOME/storages` 的两个域
（workspace、投影 checkpoint）。

## 用法

配置就是这一行的 config（聚合层 `@morlay/better-session` 的 `session-rdb` 行、profile patch，或设置页改的
那份 entry config）：

```yaml
- id: session-rdb
  name: "@morlay/session-rdb"
  config:
    type: sqlite
    # 省略 path 时回落 bundle patch 的默认（$DSH_HOME/sessions/sessions.sqlite，由 patch 的 !!js 表达式求值）；
    # 自定义路径请用绝对路径字符串。
    path: /absolute/path/to/sessions.sqlite
    journalMode: wal
    busyTimeout: 5000
```

PostgreSQL 同理：`type: postgres` + `connectionString`（可加 `schema`，默认 `public`）。改配置由 Loader 重挂
这一行生效（换后端 = 换库，旧数据留在旧后端）；字段、默认值与设置页行为见
[设计总览](.agents/designs/20260917-设计总览.md) 的「配置门面」。

管理面的 HTTP 通道（均为 `POST`，body `{ sessionId }` 或列表请求 `{ query?, includeSubagents?, page?, pageSize? }`）：
`/api/session.rows`（完整语料，含归档）、`/api/session.export`、`/api/session.delete`、`/api/session.gc`、
`/api/session.usage`。旧 `$DSH_HOME/storages` JSON 的导入是包内 API `importStorages`（`src/import-storages.ts`，
不在包出口里）。
