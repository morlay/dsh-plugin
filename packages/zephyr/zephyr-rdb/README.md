# @morlay/zephyr-rdb

**通用库**：表定义驱动的关系库工具包——一份表定义同时算 DDL、算启动迁移、算类型化的表句柄；SQLite 与
PostgreSQL 共用一套代码，业务侧只拿到注入的 `Database`，不接触方言、连接或 SQL。

能力面（查询 / 写入 / 事务 / 迁移 / 观测 / 取消 / 库身份）与方言矩阵见
[`.agents/designs/20261120-完整库设计.md`](./.agents/designs/20261120-完整库设计.md)；
业务侧接口与明确不做项见 [`.agents/designs/20261103-业务侧接口与不做项.md`](./.agents/designs/20261103-业务侧接口与不做项.md)。

## 出口

| 出口             | 内容                                                        |
| ---------------- | ----------------------------------------------------------- |
| `.`              | 表定义、方言、片段、表达式（`E`）、表句柄、`Database`、迁移 |
| `./testing`      | 测试辅助（同步 SQLite 句柄、临时 PG 库）                    |
| `./package.json` | 包清单                                                      |

它是**普通库**，没有宿主半 / 浏览器半，也没有 `./server` / `./ui`。驱动只有两个：`node:sqlite`（`DatabaseSync`）
与 `pg`。`engines.node` 声明 `>=24.11.0`：那个同步 SQLite API 要 Node 24 才稳定。

## 用法

```ts
import { column, defineTable, ensureSchema, eq, openDatabase, value } from "@morlay/zephyr-rdb";

const sessions = defineTable({
  name: "t_sessions",
  columns: {
    f_session_id: { type: "text", primaryKey: true },
    f_title: { type: "text" },
    f_state: { type: "text", notNull: true, values: ["open", "closed"] },
    f_meta: { type: "json" },
    f_created_at: { type: "integer", notNull: true },
  },
  indexes: { idx_sessions_created: { columns: ["f_created_at"] } },
});

// 装配层：连接的生命周期只在这里（和 Golang 的 session 一样，Database 是注入项）。
const database = await openDatabase({
  dialect: "sqlite",
  path: "/path/sessions.sqlite",
  identity: { name: "my-app", version: 1 }, // 打开即认领 / 校验库身份
});
await ensureSchema(database, [sessions]); // 返回 { statements, drift }

const table = database.table(sessions);
await table.insert({ f_session_id: "s1", f_state: "open", f_created_at: 1, f_meta: { a: 1 } });

// 读是迭代器（对应 Golang 的 iter.Seq2）：逐行消费，不一次性物化结果集。
for await (const row of table.select().where(eq(column("f_session_id"), value("s1")))) {
  console.log(row.f_session_id);
}

await database.transaction(async (tx) => {
  await tx.table(sessions).update({ f_title: "标题" }, eq(column("f_session_id"), value("s1")));
});

await database.close();
```

## 值类型

列类型到 JS 值是一一映射的，读回来不跟驱动走（SQLite 的 INTEGER 由驱动给 number，PostgreSQL 的 int8
默认给字符串）：

| 列类型               | 读出来的值         | 说明                                                                             |
| -------------------- | ------------------ | -------------------------------------------------------------------------------- |
| `text`               | `string`           | 带 `values` 时是受检枚举（DDL 上是 `CHECK`，写入时构造期校验）                   |
| `boolean`            | `boolean`          | PG `BOOLEAN` / SQLite `INTEGER`                                                  |
| `integer` / `serial` | `number`           |                                                                                  |
| `bigint`             | **`bigint`**       | 64 位整数（Go 的 int64 / uint64）：超过 `2^53` 也不能丢精度                      |
| `json`               | 结构化值           | SQLite 存 `TEXT`、PostgreSQL 用 `JSONB`；读写都是对象/数组，不是 JSON 文本       |
| `count()` / `sum()`  | `number \| bigint` | PostgreSQL 返回 int8（BigInt），SQLite 返回 number；要 number 就显式 `Number(x)` |

写入时 `bigint` 列也接受 `number`（安全整数范围内两者等价），业务不必到处写 `n` 后缀。

**手写片段要显式打标**：`database.read(readBigInts(fragment("SELECT …")))` 才会按 BigInt 读整数列——
标记作用于整条语句（SQLite 的开关是语句级），所以同一语句里的 INTEGER 列也会是 BigInt；表句柄不需要标记，
它按列定义自动打标并还原 INTEGER。

## 分层

| 文件          | 职责                                                                                                                                                                                                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `defs.ts`     | 表 / 列（枚举、JSON）/ 索引（含部分索引 `where`）/ catalog 的定义（唯一事实来源）                                                                                                                                                                                                 |
| `dialect.ts`  | 方言：类型映射、标识符、DDL、读现有结构（含列与索引细节）、能力声明（`supports`）                                                                                                                                                                                                 |
| `fragment.ts` | SQL 片段与参数；渲染时按方言重编号（SQLite `?`、PostgreSQL `$n`），`only` 限定方言，`readBigInts` 标记 BigInt 读取                                                                                                                                                                |
| `expr.ts`     | 条件与值表达式、窗口函数（`rowNumber` / `rank` / `lag`）、keyset 分页（`keysetAfter`）                                                                                                                                                                                            |
| `table/`      | 表句柄（业务面）：插入 / upsert / 更新 / 删除 / 迭代查询 / 计数 / 插入选择；渲染、值归一（`normalize.ts`）                                                                                                                                                                        |
| `database/`   | `Database`：`table` / `iterate` / `read` / `write` / `run` / `transaction` / `explain` / `readIdentity` / `writeIdentity` / 库级操作；连接、生命周期、库身份与队列（`create` / `sqlite` / `postgres` / `lifecycle` / `library` / `identity` / `queue` / `capabilities` / `wrap`） |
| `migrate.ts`  | 结构差异：`planSchema`（纯函数，含漂移报告）与 `ensureSchema`（缺表建表、缺列补列、缺索引补索引、索引重建）                                                                                                                                                                       |

## 事务与写通道

`database.transaction(fn)` 在两种方言上语义一致：**顶层事务按实例串行**（SQLite 单连接、PostgreSQL
`serializable` 并发会冲突），**事务内再开事务走保存点**（内层失败只回滚内层）。`Database.write` 是独立
写通道（带 `RETURNING` 的写也走它）：事务内的写属于这次事务，事务外的写与 `run` 共用写队列——不会落进
别人未提交的事务里。

**串行粒度是同进程同库**：同一进程里指向同一个库的多个 `Database` 共用一条写队列（SQLite 认解析后文件的
`dev:ino`，PostgreSQL 认连接串 + schema）。跨进程不承诺：SQLite 靠文件写锁、PostgreSQL 靠隔离级别与
`advisory lock`（迁移用）。

## 库身份

域层只声明「我是谁、版本多少」，库负责记住与校验：

```ts
const database = await openDatabase({
  dialect: "sqlite",
  path,
  identity: { name: "my-app", version: 3 },
});
await database.readIdentity(); // { fingerprint, version } | undefined
```

首次打开写入身份；之后打开必须身份与版本都一致，否则抛 `DbError("identity")`（`code: ZEPHYR_RDB_IDENTITY_MISMATCH`）
并且自己关掉句柄。SQLite 用 `PRAGMA application_id`（身份指纹）+ `PRAGMA user_version`（版本）；PostgreSQL 写在
schema 注释里（`zephyr-rdb:<指纹>:<版本>`）。

## 库级操作与观测

业务侧不该写 `PRAGMA` / `VACUUM` / `sqlite_master` / `EXPLAIN`，这些都收在 `Database` 上：

```ts
await database.objectNames(); // 现有的表与视图名
await database.vacuum(); // SQLite `VACUUM` / PostgreSQL `VACUUM ANALYZE`
await database.sqlitePragma("user_version"); // 读库身份（仅 SQLite）
await database.setSqlitePragma("user_version", 4); // 写库身份（值只允许安全字面量）
await database.explain(fragment('SELECT * FROM "t_sessions"')); // 计划行数组（方言原文）
```

`openDatabase({ onQuery })` 观测每条语句：流式读在结束（完成、出错或提前 `break`）时发一条，带实际消费行数
`rows` 与耗时。

## 取消与关闭

`read` / `iterate` / `run` / `write` / `transaction` 都收 `{ signal }`：已取消的信号在语句执行前就抛
`DbError("canceled")`（`code: ABORT_ERR`）；PostgreSQL 侧在语句执行中会发起后端取消（`pg_cancel_backend`），
SQLite 侧在语句前后与迭代行间检查（同步驱动不能中途打断一条在飞语句）。

`close()` 幂等；关闭后的语句抛 `DbError("closed")`（`code: ZEPHYR_RDB_CLOSED`）。关闭前会先关在飞游标
（PostgreSQL），SQLite 的连接延迟到在飞迭代退出后关——不会在迭代中关连接。

## 迁移

结构（建表 / 补列 / 补索引 / 索引重建）由 `ensureSchema` 从表定义算差异；**数据迁移**走注册表，账本是内置的
`t_schema_migrations`（与业务表同 schema）：

```ts
const migrations = new MigrationRegistry().register({
  id: "20261103-move-legacy-workspaces",
  up: async (tx) => {
    await tx.table(records).insertMany(rows);
  },
});

await runMigrations(database, { catalog, migrations }); // 先对齐结构，再按 id 顺序跑没记过的
```

每条迁移在**同一个事务**里执行并记账，失败即回滚、不记账，重跑只跑没记过的。并发迁移由方言保证：PostgreSQL
先拿事务级 `advisory lock`，SQLite 靠 `BEGIN IMMEDIATE` 的写锁——同一时刻只有一方在跑。

`ensureSchema` 返回 `{ statements, drift }`：`statements` 是实际执行的语句，`drift` 是「同名不同形」的清单。
可自动修的（索引列变了、索引唯一性变了、唯一约束缺失）会重建索引并进 `drift`（`fix: "auto"`）；只报告的
（列类型 / 可空 / 默认值变了）进 `drift`（`fix: "manual"`），不改表。

## 表达式（`E`）

条件：`E.eq` / `E.ne` / `E.like` / `E.inList` / `E.isNull` / `E.always` / `E.inSubquery` / `E.exists` /
`E.and` / `E.or` / `E.not` …

函数与查询写法（业务侧不必再写裸 SQL）：

| 写法                          | 作用                                                 |
| ----------------------------- | ---------------------------------------------------- |
| `E.coalesce`                  | `COALESCE(a, b, …)`                                  |
| `E.lower`                     | `lower(x)`                                           |
| `E.add(a, b)`                 | `a + b`（列自增、统计累加）                          |
| `E.excluded("f_x")`           | upsert 冲突时的 `excluded."f_x"`                     |
| `E.toInt(cond)`               | 条件当整数列（`CASE WHEN cond THEN 1 ELSE 0 END`）   |
| `E.countIf(cond)`             | 条件计数（`SUM(CASE WHEN … THEN 1 ELSE 0 END)`）     |
| `E.maxOf(a, b)`               | 只增不减（NULL 视作 0；`CASE` 写法两方言同一份）     |
| `E.localDay(col)`             | 毫秒时间戳 → 本地日 `YYYY-MM-DD`                     |
| `E.jsonText(col, p)`          | JSON 文本提取（SQLite `json_extract`、PG `#>>`）     |
| `E.jsonInt(col, p)`           | JSON 整数提取（路径形如 `$.data.usage.inputTokens`） |
| `E.rowNumber(...)`            | `ROW_NUMBER() OVER (PARTITION BY … ORDER BY …)`      |
| `E.rank(...)`                 | `RANK() OVER (…)`                                    |
| `E.lag(col, …)`               | `LAG(col, offset, fallback) OVER (…)`                |
| `E.keysetAfter(cols, values)` | keyset 分页的定位条件 `(a, b) > (?, ?)`              |

`raw(sql, params)` 是唯一逃生口，业务包里不该出现它。

## PostgreSQL

连接配置里的 `schema` 是**唯一事实来源**：结构探测、DDL、表句柄的读写、`DROP INDEX`、表别名引用、迁移账本、
库身份与 `objectNames` 都从 `Database.schema` 取，一律渲染成 `"<schema>"."<表>"`（SQLite 没有 schema 概念，
照旧不带前缀）。省略即 `public`，不依赖连接串的 `search_path`。schema 本身要由部署方先建好
（`CREATE SCHEMA ...`），本包不替你建。

```ts
const database = await openDatabase({ dialect: "postgres", connectionString, schema: "dsh_test" });
await ensureSchema(database, catalog); // CREATE TABLE "dsh_test"."t_sessions" ...
await runMigrations(database, { catalog, migrations }); // 账本也在 dsh_test
```

## 能力与方言边界

两种方言的差别是**运行期可判定**的：`dialect.supports(capability)` 是唯一判据，缺能力时抛
`DbError("unsupported")`（`code: ZEPHYR_RDB_UNSUPPORTED`），不静默降级。例如 SQLite 没有行锁：
`table.select(...).forUpdate()` 在构造期就失败，而不是把 `FOR UPDATE` 悄悄丢掉。

| 能力                                               | SQLite                  | PostgreSQL          |
| -------------------------------------------------- | ----------------------- | ------------------- |
| `schema`                                           | 无                      | 有                  |
| `row-lock`（`FOR UPDATE`）                         | 无（抛 `unsupported`）  | 有                  |
| `advisory-lock`                                    | 无（迁移靠立即事务）    | 有                  |
| `json` / `explain` / `partial-index` / `savepoint` | 有                      | 有                  |
| `vacuum-analyze`                                   | 无（只有 `VACUUM`）     | 有                  |
| bigint 读取                                        | 语句级 `setReadBigInts` | 连接级 int8 解析器  |
| 取消                                               | 语句前后 + 迭代行间     | 真取消 + 游标批次间 |

完整矩阵与判据见[`.agents/designs/20261120-完整库设计.md`](./.agents/designs/20261120-完整库设计.md)的「方言能力矩阵」。

## PostgreSQL 契约测试

`tool/pg` 是本地 dev 实例（compose）：

```sh
cd packages/zephyr/zephyr-rdb/tool/pg && just test
```

它会先起服务（compose，宿主端口 25433），再把 `TEST_PG_URL` 递给 `src/__tests__/pg.spec.ts`；不设 `TEST_PG_URL` 时
PostgreSQL 门控的用例自动跳过（照源包的 `describe.skipIf` 门控，不另行发明跳过规则）。

## 测试辅助

`@morlay/zephyr-rdb/testing` 收着测试需要的驱动能力，业务包不必为测试再依赖 `pg` / `node:sqlite`：

- `openSqliteHandle(path, options)`：同步 SQLite 句柄（造损坏数据、读 `PRAGMA`）；
- `createPostgresTestDatabase(options)`：建一个随机名的临时 PG 库，返回连接串与 `drop()`。

## 边界

- **不写 SQL**：查询、写入、DDL、迁移都从定义算出来；方言相关的东西（JSON 提取、本地日、PRAGMA、`EXPLAIN`）
  由本包渲染，业务侧只调方法。
- **迁移只做增**：缺表建表、缺列补列、缺索引补索引、索引重建；删列只在显式 `allowDestructive: true` 时才做；
  列类型 / 可空 / 默认值的变化**只报告**（`ensureSchema` 的漂移清单），不改表。
- **同进程同库串行，跨进程不承诺**：多个 `Database` 指向同一个库时共用一条写队列；跨进程靠库自己的锁。
- **业务不认数据库**：`Database` 是注入项，方言只在装配层出现；换库不改业务代码。
- 不做 ORM 的关系映射、查询缓存、跨库事务编排；`raw(sql, params)` 是唯一的逃生口。

设计与取舍见 [`.agents/designs/`](./.agents/designs)：
[`20261120-完整库设计.md`](./.agents/designs/20261120-完整库设计.md)、
[`20261103-业务侧接口与不做项.md`](./.agents/designs/20261103-业务侧接口与不做项.md)、
[`20261103-文件内分层.md`](./.agents/designs/20261103-文件内分层.md)、
[`20261120-读写通道的作用域与失败面.md`](./.agents/designs/20261120-读写通道的作用域与失败面.md)。
