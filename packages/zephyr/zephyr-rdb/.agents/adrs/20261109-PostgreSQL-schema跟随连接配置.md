# 决定：PostgreSQL 的 schema 跟着连接配置走

状态：已采纳——`Database.schema` 是「这份连接指向哪个 schema」的唯一来源，所有生成 SQL 都从它取。
背景：`OpenConfig` 的 `postgres` 分支可以配 `schema`，而初始化事务涉及建表、加列 / 索引、外键引用、迁移账本与结构探测五处。这五处若各自假设 `public`、或依赖连接的 `search_path`，配置与连接串不一致时就会「在 `public` 建表、按 `search_path` 查账本」，初始化事务直接 42P01 回滚；即使不报错，`public` 里也会留一套空表。

**决定**

**schema 是连接上的事实**：`Database` 带 `schema: string | undefined`（PostgreSQL 恒有值、缺省 `public`；SQLite 是 `undefined`），所有生成 SQL 从它取，渲染成 `"<schema>"."<表>"`：

- 结构探测（`readShape`）、建表 / 加列 / 删列 / 索引、外键引用（`REFERENCES "schema"."表"`）；
- 表句柄的全部读写与 `FROM` / `JOIN`（`src/table/handle.ts` 用方言算一次表引用，`render.ts` / `select.ts` 只拼接现成的引用）；
- 迁移账本 `t_schema_migrations`（`runMigrations` 不另开 schema 参数：账本就是一张普通表，跟着句柄走）；
- `objectNames()` 按 `database.schema` 查（`src/database/capabilities.ts`）；
- `ensureSchema` 的 `options.schema` 变成可选覆盖，缺省取 `database.schema`（`src/migrate.ts`）；
- `DROP INDEX` 与表别名（`aliasedTable`）同样限定：`dialect.indexName` 与 `dialect.tableName` 各一条规则，不自己拼字符串。

**不在连接上下 `SET search_path`**：隐式状态会和连接串里的 `options` 互相覆盖，运行期也可能被别处改掉。

**考虑过的选项**

| 选项                                                                                                | 否掉的理由                                                                                                                |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 只按最小建议传参（`ensureSchema(scoped, catalog, { schema })` + 给 `runMigrations` 加 schema 选项） | DDL 与账本对了，表句柄的读写仍跟着 `search_path`——只配 `schema`、没配 `options=-csearch_path` 的部署会把数据写到 `public` |
| 打开连接时把 `search_path` 设成配置的 schema                                                        | 连接带上隐式状态；`search_path` 里多 schema 时「建在哪」与「读到哪」仍可能不是一回事                                      |
| 只改消费方一侧                                                                                      | 其它调用方与 `wrapDatabase` 的宿主仍会踩同一个坑：schema 的渲染是本包的职责，业务包不该知道 SQL 长什么样                  |

**后果**

- `Database` 多一个 `schema` 字段（契约变化）：装配层与测试能直接看到「这份连接的目标 schema」。
- 迁移账本、结构探测、DML 与 DDL 不再可能指向不同 schema；`public` 里不会再出现副本（PG 用例断言 `information_schema` 的落位）。
- **schema 必须先存在**：本包不自动 `CREATE SCHEMA`（建 schema 的权限与所有权归部署方）；不存在时 DDL 直接报错，而不是悄悄落到 `public`。
- 用例：`src/__tests__/schema.spec.ts` 盯渲染（DDL / DML / 账本 / 探测 / 删索引 / 表别名，不需要真库），`src/__tests__/pg.spec.ts` 在真库上盯落位与幂等。
- 本仓库只有这一处 schema 机制：消费方（`packages/agent-ex/better-session` 的 rdb 层）只是把配置透传给 `openDatabase`，不为它再写一套方言用例。
