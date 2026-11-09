# PostgreSQL 的 schema 跟着连接配置走

状态：已采纳（2026-11-09）

背景：session-rdb 的 `type: postgres` 可以配 `schema`，但 rdbkit 只有「建表」一条路把它带进了 SQL：
结构探测、加列 / 索引语句、外键引用、表句柄的读写、迁移账本与 `objectNames` 都各自假设 `public` 或
依赖连接的 `search_path`。两者不一致时（[#11](https://github.com/morlay/dsh-plugin/issues/11) 的现场：
配置 `schema: dsh_test`，连接串 `search_path=dsh_test`），初始化事务在 `public` 建表与账本，接下来的
账本查询按 `search_path` 找 `dsh_test.t_schema_migrations`，直接 42P01 回滚，会话列表打不开；即使不报错，
`public` 里也会留下一套空表。

**决定**

**schema 是连接上的事实**：`Database` 带 `schema: string | undefined`，PostgreSQL 恒有值（配置给什么就是什么，
缺省 `public`），SQLite 是 `undefined`。所有生成 SQL 都从它取，渲染成 `"<schema>"."<表>"`：

- 结构探测（`readShape`）、建表 / 加列 / 索引 / 删列、外键引用（`REFERENCES "schema"."表"`）；
- 表句柄的全部读写与 `FROM` / `JOIN`（`handle.ts` 用方言算一次目标表名，[render.ts](../../src/table/render.ts)、
  [select.ts](../../src/table/select.ts) 只拼接现成的表引用）；
- 迁移账本 `t_schema_migrations`（`runMigrations` 不另开 schema 参数：账本就是一张普通表，跟着句柄走）；
- `objectNames()` 查配置的 schema；`ensureSchema` 的 `options.schema` 变成可选覆盖，缺省取 `database.schema`。

**不在连接上下 `SET search_path`**：隐式状态会和连接串里的 `options` 互相覆盖，运行期也可能被别处改掉；
显式限定才是可判读的。`wrapDatabase` 的宿主可以传 `schema`，不传就是 `public`（与默认一致）。

**考虑过的选项**

- **只按 issue 的最小建议传参**（session-rdb 调 `ensureSchema(scoped, catalog, { schema })` + 给
  `runMigrations` 加 schema 选项）：DDL 与账本对了，但表句柄的读写仍旧跟着 `search_path`——只配了
  `schema`、没配 `options=-csearch_path` 的部署会把数据写到 `public`，等于换一种方式复发。
- **打开连接时把 `search_path` 设成配置的 schema**：少改渲染层，但连接带上隐式状态（见上），而且
  `search_path` 里多 schema 时「建在哪」与「读到哪」仍可能不是一回事。
- **只改 session-rdb 一侧**：rdbkit 的其它调用方与 `wrapDatabase` 的宿主仍会踩同一个坑；schema 的渲染是
  rdbkit 的职责，业务包不该知道 SQL 长什么样。

**后果**

- `Database` 多一个 `schema` 字段（契约变化）：装配层与测试可以直接看到「这份连接的目标 schema」。
- 迁移账本、结构探测、DML 与 DDL 不再可能指向不同 schema——`public` 里不会再出现副本（PG 用例断言
  `information_schema` 的落位）。
- schema 必须先存在：rdbkit 不自动 `CREATE SCHEMA`（建 schema 的权限与所有权归部署方）；不存在时 DDL 直接报错，
  而不是悄悄落到 `public`。
- 用例：[schema.spec.ts](../../src/__tests__/schema.spec.ts) 盯渲染（DDL / DML / 账本 / 探测，不需要真库），
  [pg.spec.ts](../../src/__tests__/pg.spec.ts) 在真库上盯落位与幂等。本仓库只有这一处 schema 机制：
  session-rdb 只是把配置透传给 `openDatabase`，不为它再写一套方言用例。
