# 如何验证

本包是普通库，接缝是包根出口（`.`）与 `./testing`；测试全部按包名 import，等于顺带守住出口。

## 证据矩阵

| 改动                      | 至少跑                                                              |
| ------------------------- | ------------------------------------------------------------------- |
| 查询 / 写入 / 方言 / 迁移 | `pnpm exec vitest run packages/zephyr/zephyr-rdb`（从仓库根）       |
| 事务 / 值类型 / 库级操作  | 同上，重点是 `transaction.spec.ts` 与 `database-introspect.spec.ts` |
| 包出口、依赖面            | `just lint` + `just audit`（面边界、声明未用依赖）                  |

## 判据落点

| 接缝                                                    | spec                                                                                           |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 表定义与结构差异（`ensureSchema` / 建表 / 补列 / 索引） | `src/__tests__/schema.spec.ts`                                                                 |
| 迁移账本与数据迁移                                      | `src/__tests__/migration.spec.ts`                                                              |
| 查询渲染（投影 / join / 分组 / 分页 / 聚合）            | `src/__tests__/query.spec.ts`、`query-p1.spec.ts`、`query-join.spec.ts`、`query-write.spec.ts` |
| 表达式与 `only` 分流                                    | `src/__tests__/expr-functions.spec.ts`                                                         |
| 事务串行与保存点                                        | `src/__tests__/transaction.spec.ts`                                                            |
| 库级操作                                                | `src/__tests__/database-introspect.spec.ts`                                                    |
| 真 PostgreSQL（驱动差异、落位、幂等）                   | `src/__tests__/pg.spec.ts`（`TEST_PG_URL` 门控）                                               |

## PostgreSQL 用例的环境门控

`src/__tests__/pg.spec.ts` 是两种方言里 **PostgreSQL 那一半的契约测试**，只在环境里有真库时跑：

- 触发条件：设了 `TEST_PG_URL`（指向有建库权限的连接串）。
- 没设时整个 describe 跳过（`describe.skipIf(!process.env.TEST_PG_URL)`），不静默失败、也不假绿——SQLite 侧的用例覆盖同一套构建逻辑，PG 侧补的是驱动差异（int8 → BigInt、`SUM(bigint)` 的 cast、真游标、`BEGIN` / `SAVEPOINT`）。
- 起本地实例：`tool/pg` 的 compose，`just -f packages/zephyr/zephyr-rdb/tool/pg/justfile test` 会先 `up` 再把 `TEST_PG_URL` 递给该 spec（宿主端口 25433，避开开发者自己的 Postgres）。

日常验证不跑它：它绑端口、起容器，会被机器上别的进程挡住（判据见根 [how-to-verify.md](../../../../../.agents/standards/how-to-verify.md) 的「失败怎么处理」）。

## 两条纪律

- **`bigint` 的用例要覆盖两条读路径**：表句柄的投影与 `database.read`（见[债务 值归一有两个 home](../debts/20261103-值归一有两个home.md)）。只测句柄会漏掉第二条路径上的 `number`。
- **schema 的用例不需要真库**：`schema.spec.ts` 盯渲染文本，`pg.spec.ts` 才盯落位；改渲染规则时别把两条混成一条。
