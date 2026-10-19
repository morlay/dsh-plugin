# 实现上游 SessionHandle 模型

状态：已采纳

背景：上游 `@deepseek-ai/dsh-session-persistence` 的持久化契约是 **`SessionHandle` 模型**（`create` /
`open` / `flush` / `stat` / `list` 五个抽象方法，围绕 per-session handle 的
`read` / `append` / `flush` / `close`）。本仓库的持久化后端（`session-rdb`）、分支面
（`session-branch`）与就地编辑编排（`ui-conversation-message-actions`）都建在它上面，而上游
`@deepseek-ai/*` 不可修改（`vendor/**` 与 node_modules 只读）。

**决定**

`SessionPersistenceRdb` 实现五个抽象方法，内部复用既有 SQL 存储原语（`Backend` / `BackendTx` /
`WriteGuard`），由 `RdbSessionHandle` 实现 handle 契约：

- **create**：注册 pending（本进程可见、未 materialize），返回 write handle。
- **open**：read 不取所有权；write 原子 claim 单写者所有权（`RdbBackendTracker`）。
- **flush**：服务级屏障，drain 所有活跃 write handle。
- **stat / list**：pending + 存储行合并视图，revision 沿用 storeIdentity 派生 token。

rewind / fork 留在 `SessionPersistenceRdb` 的私有面（上游 handle 模型是 append-only，没有截断 / 删除
API），契约面是本包的 `SessionBranchProvider`
（[ADR-分支面作为与上游SessionHandle平行的provider抽象](./20260917-分支面作为与上游SessionHandle平行的provider抽象.md)）。

**考虑过的选项**

- **把 rewind / fork 也做成 handle 方法**：要往上游契约里加截断 / 删除面，违反「上游不可修改」红线。
- **自建一套持久化契约测试**：pending 可见性、单写者所有权、flush 屏障这些 handle 语义只能靠复刻上游
  契约来守，漏掉的部分没有判据。
- **把持久化语义写进本 ADR**：原样存储、不补 closers、读取视图修复、格式归一属于 session-rdb 那一层，
  写在这里就有两份说法。

**后果**

- handle 契约由 `session-rdb` 的 `src/testing/contract.ts` 复用上游 `runPersistenceContract` 守；
  `src/testing/coordinator-contract.ts` 只留 RDB 特有行为（live 驱动持久化、seed 边界、fork / resume、
  HMR drain、冲突拒绝、torn-tail）。
- 持久化语义的当前形态在 session-rdb 的
  [设计总览](../../../session-rdb/.agents/designs/20260917-设计总览.md)与
  [`.agents/adrs/`](../../../session-rdb/.agents/adrs) 里维护。
- live 会话的事件由 rdb 侧的路由缓冲、批量 drain 落库，机制见 session-rdb 的
  [设计 20260917-写路径](../../../session-rdb/.agents/designs/20260917-写路径.md)。
- 本包只需要类型适配（`SessionPersistenceSnapshot` 等）；
  `ui-conversation-message-actions` 的写入经 `sessionPersistence.append`。
