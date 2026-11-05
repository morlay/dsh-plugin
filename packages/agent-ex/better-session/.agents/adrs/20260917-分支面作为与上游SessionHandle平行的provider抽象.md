# 分支面是与上游 SessionHandle 平行的 provider 抽象

状态：已采纳——`SessionBranch` 是独立契约，实现与落盘实现共享同一个库，但不共用一个接口。

背景：上游 handle 模型只有 append-only 面（`create` / `open` / `flush` / `stat` / `list`），没有显式回退与闭合边界派生原语；而就地编辑 / 重试 / 撤回需要「截断到某个闭合边界再重写」（根术语表的「就地编辑」与「闭合边界」）。上游 `@deepseek-ai/*` 不可修改。

**决定**

在 handle 旁边定义平行契约 `SessionBranch`（`src/contract/session-branch.contract.ts`，服务名别名 `sessionBranch`）——`readBranchPrefix` / `readRawEvents` / `forkFrom` / `rewind`，由本包的 `SessionBranchRdb` 实现，内部 `SessionBranchRdbProvider` 只经 `BranchPort`（`src/rdb/branch/port.ts`）接触库。

**考虑过的选项**

| 选项                            | 否掉的理由                                                                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 扩展上游 `SessionHandle` 接口   | 违反「上游不可修改」红线                                                                                                                |
| 编排层直接操作 rdb 后端         | 契约层缺失，编排层与实现层耦合，实现无法替换                                                                                            |
| rewind 走持久化抽象的全量读路径 | `readLog` 会拉全部事件 + 旧格式转换 + 读视图修复，而 rewind 只需要「边界类型 + 截断」；现状是直连 DB 做最小工作，只有旧格式会话才读日志 |

**后果**

- 任何实现 `SessionBranch` 的后端都能接入编辑编排，不限于 RDB。
- 两个契约共享同一个库与同一条连接：`branchPort()` 由 `SessionPersistenceRdb` 交出，分支行不自己开库。
- `rewind` 只接受闭合 `turn/end` 边界、`user/message` 位置（排除该消息）或 `-1`（空前缀）；越界与非整数显式报 `INVALID_BOUNDARY`。
- `forkFrom` 是纯 append 派生新会话、不触碰源会话；父会话的事件行可复用（读取视图与存储 seq 一一对应时），否则复制行——正确优先。
- 撤回改的是**存储**：内存 log 与派生缓存（投影 / token-meter / surface）随之失效或重建，落库失败不回滚撤回（见 [设计 20261109-会话查询直读RDB读面](../designs/20261109-会话查询直读RDB读面.md) 第四节第 7 条）。
