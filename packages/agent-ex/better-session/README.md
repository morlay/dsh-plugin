# @morlay/better-session

会话的 RDB 持久化、分支数据面与就地编辑编排（宿主半）——替换官方 jsonl 落盘，并给
编辑 / 重试 / 撤回 / 分叉一条统一的编排路径。

## 用法

宿主装配函数在 `./server`：`provideBetterSession()`（RDB 落盘 / storage 接管 / 分支 / 查询 / 编辑编排 +
两组 wire 端点 `sessionEditor` / `sessionAdmin`）与 `provideSessionBalance()`（用量统计端点，可选）。

配置就是 `SessionPersistenceRdb` 的 config：

- `type: "sqlite"`：`path` 省略时落到 `<dataDir>/sessions/sessions.sqlite`（与官方 jsonl 同一个目录）；`journalMode` 默认 `wal`。
- `type: "postgres"`：`connectionString` + 可选 `schema`（默认 `public`）。**schema 由这一行的配置
  统一决定**，DDL / DML / 迁移账本 / 结构探测都渲染成 `"schema"."表"`，不依赖连接串里的
  `search_path`——所以配了 `schema` 就在这里配，别在连接串上另写一份。

浏览器半在 `./ui`：`provideBetterSessionUi()` 装两件事。

- **消息动作**：注册到 `conversation.chat.node` 的 `user` / `steering` 两个 key（`priority: -1` 覆盖官方
  内置渲染），在消息动作行上挂「编辑」（撤回该消息及其之后的内容并把全部文本块回填输入框）、「重试此回合」
  （只对已闭合轮次开放）与「分支」（从该消息之前派生出新会话）。三个动作经 `sessionEditor` 组打到宿主；
  成功后重建该会话的窗口，不整页重载。
- **对话管理页**：`sidebar.panellist` 的 nav 行与 `main` 的 `conversations` key 成对注册——会话视图
  （搜索 / 分页 / 子代理过滤 / 归档 / 取消归档 / 导出 / 删除 / 导入为会话 / 整理数据）与用量统计视图。
  列表、删除、导入、导出、整理与用量走 `sessionAdmin` 组；归档与取消归档仍委托 `uiWorkspace`。

`src/ui/vendor/dsh-client-ui-chat/**` 是从上游按需复制的薄壳 fork（消息动作行 `MessageIconActions` 与它的
两个纯工具 + 样式，共 331 行），**逐行与上游一致**——删文件与改 import 都是按「可达集 + 类型从上游包名取」
做的选择，理由见下一条判据。

## 出口

| 出口         | 是什么                                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| `.`          | 契约、默认实现（`SessionPersistenceRdb` / `SessionBranchRdb` / `SessionEditorDefault`）与 `Events` 命名空间 |
| `./endpoint` | 两组 remote 契约（`sessionEditor` / `sessionAdmin`）、两端共用的类型、分支原语与配平算法                    |
| `./server`   | 宿主面装配函数（`provideBetterSession` / `provideSessionBalance`）与端点实现                                |
| `./ui`       | 浏览器面的装配函数与实现                                                                                    |

## 判据

- 契约在 `src/contract`（进程内端口），remote 面在 `src/endpoint`，宿主实现在 `src/server/rdb/**`。
- 与 `@morlay/dsh-session-persistence` 的关系：那个包是**官方 jsonl 的适配**；本包是**替换实现**，
  只借它的 `SessionPersistence` 契约（同一个令牌，二选一），不重复它的行。边界与理由写在
  [`20261106-RDB复用边界与Remote端点形状`](./.agents/designs/20261106-RDB复用边界与Remote端点形状.md)。
- `src/ui/vendor/**` 的唯一价值是**逐行可比**：注释与 import 都保持上游形态（唯一例外是把 type-only 的
  `ChatViewSlotProps` 从上游包名取，省掉一整份 503 行的 `contract/slots.ts`）；不在 vendor 里加我们的改动，
  也不留无人引用的上游文件。
- 验证接缝与守护 spec 见 [`how-to-verify`](./.agents/standards/how-to-verify.md)；
  `pnpm exec vitest run packages/agent-ex/better-session` 与
  `pnpm exec oxlint packages/agent-ex/better-session` 是这两条接缝的入口。
