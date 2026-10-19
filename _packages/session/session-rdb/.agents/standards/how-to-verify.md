# 如何验证（数据面）

通用规则（证据矩阵、失败处理、发布纪律）见根[如何验证](../../../../../.agents/standards/how-to-verify.md)；
这里只写本包的数据面接缝、环境门控、测试辅助与判据。

## 接缝与守护 spec（`src/__tests__/`）

- **数据（provider）**：`ctx.sessionBranch`（`readBranchPrefix` / `forkFrom` / `rewind`）+
  `ctx.sessionPersistence`——持久化与分支数据面：`branch.spec.ts`、`rdb.spec.ts`、`deletion.spec.ts`、
  `import.spec.ts`、`export.spec.ts`、`gc.spec.ts`、`rows.spec.ts`。
- **分支语义的端到端用例**在 `branch.spec.ts`（真实 SQLite 后端 + coordinator 状态同步 + duck-typed agent
  驱动）；写事务的介质契约在 `write-guard.spec.ts`、`busy-timeout.spec.ts`、`multi-instance.spec.ts`、
  `multi-session.spec.ts`、`workspace-registry.spec.ts`。
- **接管面与形状**：`session-query.spec.ts`（查询接管与搜索 disabled）、`session-title.spec.ts`、
  `storage-takeover.spec.ts`、`schedule-row.spec.ts`、`projection-cache.spec.ts`、`legacy-shape.spec.ts`（自造事件类型的 `ignorable`
  信封与旧形状归一）、`inbox-repair.spec.ts`、`migrate.spec.ts`、`vendor-spec-alignment.spec.ts`、
  `config-surface.spec.ts`（行配置在设置页上的门面）。
- **rdb KV 后端服务哪些域**：`storage-takeover.spec.ts` 走真域层——`workspace` 域（记录 + 注册表状态）与
  `schedule` 域（官方 `scheduleDomain`：一个提醒一行、`put` / `delete` / 重开后读回）各自跑通，
  **不服务的域名 fail loud**（`serves only`）与 per-record 布局拒绝、版本戳不匹配仍按原样断言；
  `schedule-row.spec.ts` 再跑一次更外层的真装配：官方 `dsh-schedule` 行 + rdb 后端，`create` 落进
  `t_schedule_tasks`、换一个进程形（新 ctx、同一库）`list` 读回。加一个域时这两层都要有判据：域层（映射与
  形状）与行层（那一行真的能用）。
- **读放大（`read-path.spec.ts`）**：`load` 只走一条读取路径（以注入后端的 `getEventRows` 调用计数为证）、
  rewind 的类型查询只取 `fSequence` / `fType` 两列（行键集为证）、读视图修复一次扫描建好溯源索引
  （replace 的 `sourceEventSeqs` 与 metering 的 `shadowedSeqs` 形状为证）。判的是**每条读取路径付的代价**，
  不是实现细节；性能类改动没有行为红，靠这三条接缝观测 + 既有读视图用例兜回归。
- **live 失败态（`live-failure.spec.ts`）**：初始化失败（同名会话 cwd 冲突）后记账一条 `error`、
  后续事件被丢弃（每会话一条 `warn`）、`flush` 把失败抛回上游——判据是**日志面 + flush 的拒绝**，
  不查私有缓冲。
- **统计口径与派生表**：`usage.spec.ts`（口径、回填、迁移重建、旁路累加、变更后重算），
  PG 侧同形用例在 `pg.spec.ts`。

## 环境门控

- 默认后端是 SQLite `:memory:`，无需外部服务。
- **PostgreSQL 契约测试**（`pg.spec.ts`）需要 `TEST_PG_URL`：本地用 `just pg test`（docker compose 起库并注入
  连接串），CI 由 postgres service 提供；未设置时 `describe.skipIf` 自动跳过。按根规范，这类起真实服务的探针
  只在**人工排查**时跑，日常验证用不起服务的证据覆盖。
  除持久化 / coordinator 契约外，这里还有**写事务串行**的用例（「并发写事务不交错（失败的那个不留痕迹）」）：
  并发 `putWorkspace`，失败的那个必须整体回滚不留痕迹——判据是介质层的原子性，不是实现细节。

## 测试辅助（`./testing`）

- **契约 fixture**：`contract.ts` 的 `runPersistenceContract` / `ContractBackend`、
  `coordinator-contract.ts` 的 `runCoordinatorContract` / `CoordinatorFixture`；
- 日志 fixture：`meta` / `oneTurnLog` / `appendLog`，以及 `truncateLiveSession`；
- 投影注册用上游 `new SessionProjectionRegistry(ctx)`（`@deepseek-ai/dsh-session-projection`）。

## 用量统计的判据（`usage.spec.ts` / `pg.spec.ts`）

判据是**口径**而不是实现：只算被会话引用的事件行（fork 共享行计一次、孤儿行不计）、`subagent` / `human` 拆分、
时间范围按语义键过滤（起点对齐本地零点）；活动计数（轮次 / 步骤 / 用户输入 / 工具调用）读派生表
`t_session_counts`（不在 `t_events` 上现数）、与 token 同一会话集合（有 token 用量的会话），按模型的行只带
token 用量、按会话的行含 fork 继承前缀。PG 侧同形，`pg.spec.ts` 里真跑一次（不能只靠 SQLite 覆盖两套 SQL）。
int4 修复由 PG 侧用量用例守着（毫秒时间戳能落进 `t_event_usage`）。

## 派生统计表（`usage.spec.ts`）

三张表（`t_event_usage` / `t_session_usage` / `t_session_counts`）都是可销毁重建的派生数据，判据是：

- **回填可用**：表清空后重开，报表数值按事件表恢复（幂等，再开一次不翻倍）；
- **迁移重建**：旧结构的库（缺物化列的 `t_event_usage` + 按类型存的 `t_event_counts`）过一遍
  `20260923120000_v3_usage_materialized` 后是新结构，且数值由回填补齐；
- **旁路累加**：事件写入后报表里的 token 与四项计数随之变化；
- **变更后重算**：fork 复用的事件行归到子会话（`f_subagent` 由全量重算补齐）、子会话行含继承前缀，
  删除会话后其用量立刻退出统计（在 GC 之前）。

不判实现内部的累加语句。
