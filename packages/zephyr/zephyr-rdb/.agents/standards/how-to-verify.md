# 如何验证

本包是普通库，接缝是包根出口（`.`）与 `./testing`；测试全部按包名 import，等于顺带守住出口。

## 证据矩阵

| 改动                               | 至少跑                                                                                              |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| 查询 / 写入 / 方言 / 迁移 / 库身份 | `pnpm exec vitest run packages/zephyr/zephyr-rdb`（从仓库根）                                       |
| 格式与 lint                        | `pnpm exec oxlint packages/zephyr/zephyr-rdb`、`pnpm exec oxfmt --check packages/zephyr/zephyr-rdb` |
| 事务 / 值类型 / 生命周期 / 取消    | 同上，重点是 `transaction.spec.ts`、`bigint-read.spec.ts`、`lifecycle.spec.ts`、`cancel.spec.ts`    |
| 包出口、依赖面                     | `just lint` + `just audit`（面边界、声明未用依赖）                                                  |

## 判据落点

| 接缝                                                               | spec                                                                             |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| 表定义与结构差异（`ensureSchema` / 建表 / 补列 / 索引 / 部分索引） | `schema.spec.ts`                                                                 |
| 结构漂移（同名不同形、类型/可空/默认值、唯一约束缺失）             | `schema-drift.spec.ts`                                                           |
| 迁移账本与数据迁移                                                 | `migration.spec.ts`                                                              |
| 迁移并发锁（SQLite 立即事务 / PG advisory lock）                   | `migration-lock.spec.ts`                                                         |
| 查询渲染（投影 / join / 分组 / 分页 / 聚合）                       | `query.spec.ts`、`query-p1.spec.ts`、`query-join.spec.ts`、`query-write.spec.ts` |
| 窗口函数                                                           | `window.spec.ts`                                                                 |
| keyset 分页与递归 CTE                                              | `paging-keyset.spec.ts`                                                          |
| 枚举与 JSON 列                                                     | `json-and-enum.spec.ts`                                                          |
| 表达式与 `only` 分流                                               | `expr-functions.spec.ts`                                                         |
| 事务串行与保存点                                                   | `transaction.spec.ts`                                                            |
| 事务执行面归属（假 `Executor`）                                    | `transaction-scope.spec.ts`                                                      |
| 写通道（`RETURNING` 不落进未提交事务）                             | `write-channel.spec.ts`                                                          |
| 值类型与健壮性（分页、未知列、错误分类）                           | `robustness.spec.ts`                                                             |
| 三条读路径的大整数                                                 | `bigint-read.spec.ts`                                                            |
| 生命周期（幂等关闭、`closed`、在飞游标）                           | `lifecycle.spec.ts`                                                              |
| 能力矩阵与 `unsupported`                                           | `capability-matrix.spec.ts`                                                      |
| 观测（流式事件、`EXPLAIN`）                                        | `observe.spec.ts`                                                                |
| 取消（`AbortSignal`，PG 真取消）                                   | `cancel.spec.ts`（PG 段门控）                                                    |
| 库级操作                                                           | `database-introspect.spec.ts`                                                    |
| 同进程同库共享写队列                                               | `library-queue.spec.ts`                                                          |
| 库身份读写与版本拒绝                                               | `identity.spec.ts`（PG 段门控）                                                  |
| 真 PostgreSQL（驱动差异、落位、幂等、schema）                      | `pg.spec.ts`（`TEST_PG_URL` 门控）                                               |

## PostgreSQL 用例的环境门控

PostgreSQL 那一半的契约测试只在环境里有真库时跑：

- 触发条件：设了 `TEST_PG_URL`（指向有建库权限的连接串）。
- 没设时整个 describe 跳过（`describe.skipIf(!process.env.TEST_PG_URL)`），不静默失败、也不假绿——SQLite 侧的用例覆盖同一套构建逻辑，PG 侧补的是驱动差异（int8 → BigInt、`SUM(bigint)` 的 cast、真游标、真取消、`BEGIN` / `SAVEPOINT`、advisory lock、schema 注释身份）。
- 起本地实例：`tool/pg` 的 compose，`just -f packages/zephyr/zephyr-rdb/tool/pg/justfile test` 会先 `up` 再把 `TEST_PG_URL` 递给 spec（宿主端口 25433，避开开发者自己的 Postgres）。

日常验证不跑它：它绑端口、起容器，会被机器上别的进程挡住（判据见根 [how-to-verify.md](../../../../../.agents/standards/how-to-verify.md) 的「失败怎么处理」）。

## 三条纪律

- **`bigint` 的用例要覆盖三条读路径**：表句柄的投影、`RETURNING`、`read(readBigInts(fragment(...)))`（见[债务 值归一只走了一条读路径](../debts/20261103-值归一只走了一条读路径.md)）。只测句柄会漏掉手写片段那条路径。
- **schema 的用例不需要真库**：`schema.spec.ts` / `schema-drift.spec.ts` 的渲染与漂移判定用假 shape 或 SQLite；`pg.spec.ts` / `schema-drift.spec.ts` 的 PG 段才盯落位；改渲染规则时别把两条混成一条。
- **能力矩阵两侧都要钉**：`capability-matrix.spec.ts` 既断言 `supports` 的逐项判定，也断言缺能力时抛 `unsupported`（不是静默丢弃）。

## 测试数据与隔离

结论：`:memory:` 优先；需要两连接共享或要读 `PRAGMA` / 库文件时，用 `mkdtemp` 的临时库并在 `afterEach` 删除。

| 判据                                                                | 怎么查                                                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 不用 `beforeAll` 建库（用例之间不共享库状态）                       | `grep -rn 'beforeAll' packages/zephyr/zephyr-rdb/src/__tests__` 应为 0    |
| 落文件的用例用临时目录                                              | `grep -rn 'mkdtemp\\                                                      | tmpdir()' packages/zephyr/zephyr-rdb/src/**tests**` 覆盖全部写文件用例（`database-introspect` 已有） |
| `:memory:` 只用于单连接用例；跨连接读同一份库必须走文件 + `tempDir` | 评审：一个用例里出现两次 `openDatabase` 时看路径                          |
| 固定路径不得作为数据根                                              | `grep -rn 'path: "[^:]' src/__tests__` 的命中必须是业务字段值，不是库文件 |
