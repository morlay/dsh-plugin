# @morlay/rdbkit

**表定义驱动的关系库工具包**：一份表定义同时算 DDL、算启动迁移、算类型化的表句柄；SQLite 与 PostgreSQL
共用一套代码，业务侧只拿到注入的 `Database`，不接触方言、连接或 SQL。

## 用法

```ts
import { column, defineTable, ensureSchema, eq, openDatabase, value } from "@morlay/rdbkit";

const sessions = defineTable({
  name: "t_sessions",
  columns: {
    f_session_id: { type: "text", primaryKey: true },
    f_title: { type: "text" },
    f_created_at: { type: "integer", notNull: true },
  },
  indexes: { idx_sessions_created: { columns: ["f_created_at"] } },
});

// 装配层：连接的生命周期只在这里（和 Golang 的 session 一样，Database 是注入项）。
const database = await openDatabase({ dialect: "sqlite", path: "/path/sessions.sqlite" });
await ensureSchema(database, [sessions]);

const table = database.table(sessions);
await table.insert({ f_session_id: "s1", f_created_at: 1 });

// 读是迭代器（对应 Golang 的 iter.Seq2）：逐行消费，不一次性物化结果集。
for await (const row of table.select().where(eq(column("f_session_id"), value("s1")))) {
  console.log(row.f_session_id);
}

await database.transaction(async (tx) => {
  await tx
    .table(sessions)
    .update({ f_title: "标题" }, eq(column("f_session_id"), value("s1")));
});

await database.close();
```

## 值类型

列类型到 JS 值是一一映射的，读回来不跟驱动走（SQLite 的 INTEGER 由驱动给 number，PostgreSQL 的 int8
默认给字符串）：

| 列类型                      | 读出来的值  | 说明                                                         |
| --------------------------- | ----------- | ------------------------------------------------------------ |
| `text`                      | `string`    |                                                              |
| `boolean`                   | `boolean`   | PG `BOOLEAN` / SQLite `INTEGER`                              |
| `integer` / `serial`        | `number`    |                                                              |
| `bigint`                    | **`bigint`** | 64 位整数（Go 的 int64 / uint64）：超过 `2^53` 也不能丢精度 |
| `count()` / `sum()`         | `number \| bigint` | PostgreSQL 返回 int8（BigInt），SQLite 返回 number；要 number 就显式 `Number(x)` |

写入时 `bigint` 列也接受 `number`（安全整数范围内两者等价），业务不必到处写 `n` 后缀。

## 分层

| 文件          | 职责                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------- |
| `defs.ts`     | 表 / 列 / 索引 / catalog 的定义（唯一事实来源；`defineTable` 保留字面量类型供推导）          |
| `dialect.ts`  | 方言：类型映射、标识符、DDL（建表 / 索引 / 加列）、读现有结构（PRAGMA / information_schema） |
| `fragment.ts` | SQL 片段与参数；渲染时按方言重编号（SQLite `?`、PostgreSQL `$n`），`only` 限定方言           |
| `expr.ts`     | 条件表达式（`eq` / `inList` / `and` / `or` …）与函数表达式，值一律走绑定参数（见下）         |
| `table/`      | 表句柄（业务面）：插入 / 插入忽略 / upsert / 更新 / 删除 / 迭代查询 / 计数 / 插入选择（`types` / `handle` / `render` / `select`） |
| `database/`   | `Database`（注入项）：`table` / `iterate` / `read` / `run` / `transaction` / 库级操作（`types` / `create` / `sqlite` / `postgres` / `capabilities` / `wrap` / `queue`） |
| `migrate.ts`  | 结构差异：`planSchema`（纯函数）与 `ensureSchema`（缺表建表、缺列补列、缺索引补索引）        |

## 事务

`database.transaction(fn)` 在两种方言上语义一致：**顶层事务按实例串行**（SQLite 单连接、PostgreSQL
`serializable` 并发会冲突），**事务内再开事务走保存点**（内层失败只回滚内层）。事务内的写自动算这一段事务的
一部分；事务外的写先排队，不会落进别人未提交的事务里。

## 库级操作

业务侧不该写 `PRAGMA` / `VACUUM` / `sqlite_master`，这些都收在 `Database` 上：

```ts
await database.objectNames(); // 现有的表与视图名
await database.vacuum(); // SQLite `VACUUM` / PostgreSQL `VACUUM ANALYZE`
await database.sqlitePragma("user_version"); // 读库身份（仅 SQLite）
await database.setSqlitePragma("user_version", 4); // 写库身份（值只允许安全字面量）
```


## PostgreSQL schema

连接配置里的 `schema` 是**唯一事实来源**：结构探测、DDL、表句柄的读写、迁移账本与 `objectNames` 都从
`Database.schema` 取，一律渲染成 `"<schema>"."<表>"`（SQLite 没有 schema 概念，照旧不带前缀）。省略即
`public`，不依赖连接串的 `search_path`。schema 本身要由部署方先建好（`CREATE SCHEMA ...`），rdbkit 不替你建。

```ts
const database = await openDatabase({ dialect: "postgres", connectionString, schema: "dsh_test" });
await ensureSchema(database, catalog); // CREATE TABLE "dsh_test"."t_sessions" ...
await runMigrations(database, { catalog, migrations }); // 账本也在 dsh_test
```

## 迁移

结构（建表 / 补列 / 补索引）由 `ensureSchema` 从表定义算差异；**数据迁移**走注册表，账本是内置的
`t_schema_migrations`（与业务表同 schema，见上节）：

```ts
const migrations = new MigrationRegistry().register({
  id: "20261103-move-legacy-workspaces",
  up: async (tx) => {
    await tx.table(records).insertMany(rows);
  },
});

await runMigrations(database, { catalog, migrations }); // 先对齐结构，再按 id 顺序跑没记过的
```

每条迁移在**同一个事务**里执行并记账，失败即回滚、不记账，重跑只跑没记过的。

## 表达式（`E`）

条件：`E.eq` / `E.ne` / `E.like` / `E.inList` / `E.isNull` / `E.always` / `E.inSubquery` / `E.exists` /
`E.and` / `E.or` / `E.not` …

函数与方言无关写法（业务侧不必再写裸 SQL）：

| 写法                  | 作用                                                     |
| --------------------- | -------------------------------------------------------- |
| `E.coalesce`          | `COALESCE(a, b, …)`                                      |
| `E.lower`             | `lower(x)`                                               |
| `E.add(a, b)`         | `a + b`（列自增、统计累加）                              |
| `E.excluded("f_x")`   | upsert 冲突时的 `excluded."f_x"`                         |
| `E.toInt(cond)`       | 条件当整数列（`CASE WHEN cond THEN 1 ELSE 0 END`）       |
| `E.countIf(cond)`     | 条件计数（`SUM(CASE WHEN … THEN 1 ELSE 0 END)`）         |
| `E.maxOf(a, b)`       | 只增不减（NULL 视作 0；`CASE` 写法两方言同一份）         |
| `E.localDay(col)`     | 毫秒时间戳 → 本地日 `YYYY-MM-DD`                         |
| `E.jsonText(col, p)`  | JSON 文本提取（SQLite `json_extract`、PG `#>>`）         |
| `E.jsonInt(col, p)`   | JSON 整数提取（路径形如 `$.data.usage.inputTokens`）     |

`raw(sql, params)` 是唯一逃生口，业务包里不该出现它。

## PostgreSQL 契约测试

`tool/pg` 是本地 dev 实例（compose），根目录 `just pg test` 会先起服务再跑 `src/__tests__/pg.spec.ts`；
不设 `TEST_PG_URL` 时这些用例自动跳过。

## 测试辅助

`@morlay/rdbkit/testing` 收着测试需要的驱动能力，业务包不必为测试再依赖 `pg` / `node:sqlite`：

- `openSqliteHandle(path, options)`：同步 SQLite 句柄（造损坏数据、读 `PRAGMA`）；
- `createPostgresTestDatabase(options)`：建一个随机名的临时 PG 库，返回连接串与 `drop()`。

## 边界

- **不写 SQL**：查询、写入、DDL、迁移都从定义算出来；方言相关的东西（JSON 提取、本地日、PRAGMA）由
  rdbkit 渲染，业务侧只调方法。
- **迁移只做增**：缺表建表、缺列补列、缺索引补索引；删列只在显式 `allowDestructive: true` 时才做，
  不改类型、不删索引（旧库升级不丢数据）。
- **业务不认数据库**：`Database` 是注入项，方言只在装配层出现；换库不改业务代码。
- 不做 ORM 的关系映射、不做查询缓存、不做跨库事务编排；`raw(sql, params)` 是唯一的逃生口。

