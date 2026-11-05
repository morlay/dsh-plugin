# 用上游的 SessionHandle 模型实现会话落盘

状态：已采纳——落盘实现（`SessionPersistenceRdb`）与分支面各自一份契约，二者不混。

背景：上游 `@deepseek-ai/dsh-session-persistence` 的持久化契约是 **`SessionHandle` 模型**：服务级五个方法（`create` / `open` / `flush` / `stat` / `list`），每个会话一个 handle（`read` / `append` / `flush` / `close`）。本仓库的落盘替换实现（本包）、分支面与就地编辑编排都建在它上面，而上游 `@deepseek-ai/*` 不可修改。

**决定**

`SessionPersistenceRdb` `extends SessionPersistence`（`packages/agent/dsh-session-persistence/src/contract/session-persistence.contract.ts`），用既有的 SQL 存储原语（`Backend` / `BackendTx` / `WriteGuard`）实现五个方法，由 `RdbSessionHandle`（`src/rdb/handles.ts`）实现 handle 契约：

- `create`：注册 pending（本进程可见、未物化），返回写 handle；
- `open`：`read` 不取所有权；`write` 原子抢占单写者所有权（`RdbBackendTracker.claimWrite`），失败释放声明；
- `flush`：服务级屏障，排空所有活跃写 handle（`tracker.flushAll()`）；
- `stat` / `list`：pending + 存储行的合并视图，revision 由 `storeIdentity:incarnation:revision` 派生。

rewind / fork 留在**平行契约** `SessionBranch`（[ADR-分支面作为与上游 SessionHandle 平行的 provider 抽象](./20260917-分支面作为与上游SessionHandle平行的provider抽象.md)）与 `SessionRdbStore.branchPort()` 上，不进 handle。

**考虑过的选项**

| 选项                                                       | 否掉的理由                                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 把 rewind / fork 也做成 handle 方法                        | 要往上游契约里加截断 / 删除面，违反「上游不可修改」红线                                    |
| 自建一套持久化契约测试                                     | pending 可见性、单写者所有权、flush 屏障这些语义只能靠复刻上游契约来守，漏掉的部分没有判据 |
| 把持久化语义（原样存储、读视图修复、格式归一）写进这条 ADR | 那些语义的 home 在 `dsh-session` / `dsh-session-persistence` 两层，写在这里就有两份说法    |

**后果**

- handle 契约由域里的 `runPersistenceContract`（`packages/agent/dsh-session-persistence/src/testing/contract.ts`）守，本包只补「readFrom 从指定 seq 起读，读视图与整段读一致」这类补充判据（`src/__tests__/persistence-contract.spec.ts`）。
- 写者位点由 `WriteGuard` 守：两个实例的基准位点过期时**拒绝**写入而不是覆盖（`src/__tests__/concurrency.spec.ts`）。
- 会话事件由 `@morlay/dsh-session` 的 `Events` 提供，本包只订阅；因此包根不导出 `Events`（`src/__tests__/exports.spec.ts` 断言这一点）。
- 编辑编排写日志走 handle 面（`sessionPersistence.append`），撤回 / 分叉走 `SessionBranch`——两条面各自只有一处入口。
