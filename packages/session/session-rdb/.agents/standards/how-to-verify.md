# 如何验证（数据面）

通用规则（证据矩阵、失败处理、发布纪律）见根[如何验证](../../../../../.agents/standards/how-to-verify.md)；
这里只写本包的数据面接缝、环境门控与测试辅助。

## 接缝与守护 spec（`src/__tests__/`）

- **数据（provider）**：`ctx.sessionBranch`（`readBranchPrefix` / `forkFrom` / `rewind`）+
  `ctx.sessionPersistence`——持久化与分支数据面：`branch.spec.ts`、`rdb.spec.ts`、`deletion.spec.ts`、
  `import.spec.ts`。
- **分支语义的端到端用例**在 `branch.spec.ts`（真实 SQLite 后端 + coordinator 状态同步 + duck-typed
  agent 驱动）。
- 其余面各自成 spec：`write-guard`、`busy-timeout`、`multi-instance`、`multi-session`、
  `projection-cache`、`session-query`、`session-title`、`storage-takeover`、`migrate`、`inbox-repair`、
  `vendor-spec-alignment`。
- **读放大（`read-path.spec.ts`）**：`load` 只走一条读取路径（以注入后端的 `getEventRows` 调用计数为证）、
  rewind 的类型查询只取 `fSequence` / `fType` 两列（行键集为证）、读视图修复一次扫描建好溯源索引
  （replace 的 `sourceEventSeqs` 与 metering 的 `shadowedSeqs` 形状为证）。判的是**每条读取路径付的代价**，
  不是实现细节；性能类改动没有行为红，靠这三条接缝观测 + 既有读视图用例兜回归。
- **live 失败态（`live-failure.spec.ts`）**：初始化失败（同名会话 cwd 冲突）后记账一条 `error`、
  后续事件被丢弃（每会话一条 `warn`）、`flush` 把失败抛回上游——判据是**日志面 + flush 的拒绝**，
  不查私有缓冲。

## 环境门控

- 默认后端是 SQLite `:memory:`，无需外部服务。
- **PostgreSQL 契约测试**（`pg.spec.ts`）需要 `TEST_PG_URL`：本地用 `just pg test`（docker compose 起库
  并注入连接串），CI 由 postgres service 提供；未设置时 `describe.skipIf` 自动跳过。
  除持久化 / coordinator 契约外，这里还有**写事务串行**的用例（「并发写事务不交错（失败的那个不留痕迹）」）：
  并发 `putWorkspace`，失败的那个必须整体回滚不留痕迹——判据是介质层的原子性，不是实现细节。

## 测试辅助（`./testing`）

- `EmptySettings`：空 settings provider，满足插件的 `static inject: ['settings']`；
- **契约 fixture**：`contract.ts` 的 `runPersistenceContract` / `ContractBackend`、
  `coordinator-contract.ts` 的 `runCoordinatorContract` / `CoordinatorFixture`；
- 日志 fixture：`meta` / `oneTurnLog` / `appendLog`，以及 `truncateLiveSession`；
- 投影注册用上游 `new SessionProjectionRegistry(ctx)`（`@deepseek-ai/dsh-session-projection`）。

## 用量统计（`usage.spec.ts` / `pg.spec.ts`）

判据是**口径**而不是实现：只算被会话引用的事件行（fork 共享行计一次、孤儿行不计）、
`subagent / human` 拆分、时间范围按语义键过滤；活动计数（轮次 / 步骤 / 用户输入 / 工具调用）按派生表
`t_event_counts` 读（不在 `t_events` 上现数）、与 token 同一会话集合（有 token 用量的会话），按模型的行只带 token 用量。
PG 侧同形，`pg.spec.ts` 里真跑一次（不能只靠 SQLite 覆盖两套 SQL）。

## 活动计数（`usage.spec.ts`）

`t_event_counts` 是派生表：判据是**回填可用**（表清空后重开，按事件表重算）与**旁路累加**（事件写入后
报表里的轮次 / 步骤 / 用户输入 / 工具调用随之变化），不判实现内部的累加语句。int4 修复由 PG 侧
`pg.spec.ts` 的用量用例守着（毫秒时间戳能落进 `t_event_usage`）。
