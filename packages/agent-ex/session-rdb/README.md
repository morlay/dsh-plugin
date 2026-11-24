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
- 库身份：`SESSION_PERSISTENCE_SQLITE_APPLICATION_ID` 是**库身份指纹**（`identityFingerprint("dsh-session") | 0`），
  落在 SQLite 的 `PRAGMA application_id`（写入只收有符号 int32，读回是同一段 32 位的无符号表示，
  比较前两侧归一）。版本对不上、或 `application_id` 是**别的** id 的库被显式拒绝
  （`SESSION_STORAGE_INCOMPATIBLE`）。唯一的例外是本仓更早版本写的旧身份 `0x44534850`（ASCII "DSHP"）：
  那是自己的旧库，打开时就地升级成当前指纹（一次迁移，写在打开事务里，不要求删库）。
  机制与读写面见 `@morlay/zephyr-rdb` 的[库身份](../../zephyr/zephyr-rdb/README.md)一节。

浏览器半在 `./ui`：`provideBetterSessionUi()` 装两件事。

- **消息动作**：注册到 `conversation.chat.node` 的 `user` / `steering` 两个 key（`priority: -1` 覆盖官方
  内置渲染），在消息动作行上挂「编辑」（撤回该消息及其之后的内容并把全部文本块回填输入框）与「重试此回合」
  （只对已闭合轮次开放）**两个**动作。分叉不在这一行：它属于回合末尾（上游 `TurnTailNodeView` 的
  `onBranch`）。两个动作经 `sessionEditor` 组打到宿主；成功后重建该会话的窗口，不整页重载。
- **对话管理页**：`sidebar.panellist` 的 nav 行与 `main` 的 `conversations` key 成对注册——视图 chip
  （会话 / 统计）切换会话视图（搜索 / 分页 / 子代理、时间与归档筛选 / 归档 / 取消归档 / 批量归档 / 导出 /
  导出筛选结果 / 覆盖导入 / 复制到工作区 / 单条与批量删除 / 导入为会话 / 批量导入 / 事件定位 / 整理数据 /
  数据体检 / 单会话修复）与用量统计视图。
  列表、删除（含批量）、导入、导出（含按筛选结果批量导出）、复制到工作区、整理、体检、修复与用量走
  `sessionAdmin` 组；归档、取消归档与批量归档仍委托 `uiWorkspace`（批量归档是页面逐条调用再聚合结果，
  本包不加第二个归档入口）。
  标题行的「数据体检」（`data-action="consistency"`）把报告落到面板上（不一致项逐条 `data-issue`，只报不修）；
  行上的「修复」（`data-action="repair"`）先开确认弹窗，再选丢坏尾部 / 整段重写（危险语义）；删除走既有删除入口。
  - 时间 chip 的窗口是**本地自然日**：近 7 / 30 天 = 今天本地零点往前 6 / 29 天（`rows-query.ts` 的
    `localDayWindowStart`，与宿主统计的本地日同一口径），不是「此刻减 N × 24 小时」的滚动窗口。
  - `sessionAdmin/rows` 的过滤参数：`updatedAfter` / `updatedBefore`（与行的 `updatedAt` 同列）、`origin`
    （`human` / `subagent`，与 `includeSubagents` 同时给时 `origin` 优先）、`archived`（`only` / `unarchived`），
    与 `query` 进同一个 WHERE。返回的 `searchStage` 是**实际**走的搜索段：标题先前缀（对 `lower(f_title)`
    做范围比较 `>= ? AND < ?`（SQLite）/ `like(lower(f_title), 'x%')`（PG），与全文段同一个大小写口径），
    没命中才退全文 `%x%`。前缀段现在用不上索引（SQLite 的计划是整表扫），见
    [标题前缀搜索用不上 idx_sessions_title](./.agents/debts/20261120-标题前缀搜索用不上idx_sessions_title.md)。
  - 批量删除：`sessionAdmin/bulkDelete` 一次请求、逐条结果：`{ items: [{ sessionId, ok, code? }] }`；未归档 /
    运行中 / 不存在各自带域码，整批不回滚。页面上的多选条有两个动作（`data-bulk` 为 `active` 时出现）：
    「批量删除」（`data-action="bulk-remove"`，危险确认）与「批量归档」（`data-action="bulk-archive"` →
    确认弹窗 `data-action="bulk-archive-confirm"`）。批量归档不进本包：页面逐条调 `uiWorkspace` 的归档动作
    （归档的 owner 在 workspace 域，经 storage 接管写穿到会话行的 `f_archived_at`），失败条聚合成一条提示
    （「已归档 N 条会话，M 条失败」+ 失败项的会话与原因），结算后清空选择并重拉。
  - `sessionAdmin/locate`：会话内定位事件。`fromSeq` / `toSeq` 是**闭区间**（省略即整段日志），
    越界（`toSeq` 超过日志最后一条 seq）、两端颠倒、不是非负整数都显式失败
    （`SESSION_QUERY_INVALID_WINDOW`）——不做静默夹取，「看的是哪一段」不该变成猜测。条件全部下推到 SQL：
    文本 `LIKE %text%`（大小写不敏感）、`types` / `role` / `name`、事件时间的闭区间。只回 seq 与行上的维度
    （type / role / name / time）加**命中片段**（优先事件语义文本，坏行退回原文；命中点两侧各 40 字符，
    没有文本条件时截 80 字符），不搬事件体——所以**坏会话照样能定位**（排障先看坏在哪一行，再 `repair`）。
    `total` 是命中总数（不受 `limit` 影响；`limit` 默认 50、上限 200）。页面入口是行上的「定位」
    （`data-action="locate"`）：弹窗里文本 / 类型 / 角色 / 工具名四栏 + 时间两栏（换成本地时区的毫秒下推，
    空栏不出现）；结果区 `data-locate="results"` 带 `data-locate-window="<from>-<to>"`，命中逐条
    `data-locate-hit="<seq>"`。只读——命中列表里没有动作按钮，修法走 `repair`。
  - `sessionAdmin/repair`：坏会话的三种修法，逐会话、只碰目标会话，都要求显式调用。可读边界 = 从头逐行读时
    第一条解析不出来或序号断号的行。`drop-tail` 只丢边界之后的尾部（之前的原样保留，head 跟着收，统计按剩下
    的日志重算），**被丢的事件行只删桥接行、事件行留成孤儿**，由 `organize` 的 `collectOrphans` 回收；
    `rewrite` 按同一个边界把可读前缀整段重写（复用写路径的 `replaceSessionLog`：截断 / 重写 / head 复位 /
    seed 收缩同一事务，seed 长度收在日志长度内）；`delete` 走现有删除守卫（已归档、非运行中）。
    守卫：会话不存在 → `SESSION_NOT_FOUND`；两个日志修法在运行中的会话上拒绝（`SESSION_LIVE`；删除那一支
    用删除自己的运行中守卫）。回报 `keptEvents` / `droppedEvents`。
  - `sessionAdmin/consistency`：体检——三张派生表（事件用量 / 会话用量 / 四项计数）与事件行、桥接行是否对得上，
    **只读、只报、不修**：回 `ok`、扫过的行数（会话 / 事件 / 桥接 / 用量行 / 计数行）与逐条 `issues`
    （`kind` + `subject` + 期望与实际的差）。口径只证明「该有的都在」：统计**大于**重算的是历史消耗（撤回与
    覆盖导入不退统计），不是漂移；小于重算、或行根本不存在才是漏记。修法不在这里——重算归 `organize`，
    读不出来的会话归 `repair`。
  - `sessionAdmin/exportMany` / `sessionAdmin/importMany`：批量导出 / 导入，整批一次请求、结果逐条。
    `exportMany({ sessionIds })` 每条一份 zip（内容仍是上游 format 的 JSONL，文件名 `<sessionId>.zip`），
    不存在的会话带 `SESSION_NOT_FOUND`；`importMany({ zips })` 每条落成新会话，包里没有上游 format artifact
    的带 `SESSION_IMPORT_NO_ARTIFACT`——整批不回滚。页面入口是标题行的「导出筛选结果」
    （`data-action="export-filtered"`：按当前搜索与筛选逐页收全 id，再一次 `exportMany`，逐条落成下载）。
    批量导入的页面入口是同一个文件输入（`multiple`）：选一个文件仍走单条导入（「导入为会话」/ 覆盖导入，
    带 `reading` → `committing` 阶段提示），选多个 zip 一次走 `sessionAdmin/importMany`，好包各落成一条新会话、
    坏包按**选中的文件名**给原因（聚合提示「已导入 N 个会话，M 个失败」）——整批不回滚。
  - `sessionAdmin/copyToWorkspace`：**编排层的动作，本包只转发**。复制 = `fork`（本包的分支原语
    `SessionBranching`）+ workspace 域的 `attach`（`SessionWorkspace`），两件事的组合住在
    `@morlay/dsh-workspace`（`SessionWorkspaceCopy`）：持久化行不认识 workspace，跨域动作不上数据面。
    子会话的 `cwd` 换成目标工作区路径，源会话原样保留（复制不是移动）；工作区不在注册表给
    `SESSION_COPY_WORKSPACE_NOT_FOUND`，attach 失败撤掉刚派生的子会话并给 `SESSION_COPY_ATTACH_FAILED`
    （码由本包端点按端口给的原因映射，文案仍是本域词汇）。行上入口是「复制到工作区」
    （`data-action="copy"`）：先读工作区快照列表，确认弹窗里选目标工作区（`data-action="copy-confirm"`）再复制。
  - 失败文案只认码（`failure.ts` 的 `failureText`）：`SESSION_NOT_ARCHIVED` / `SESSION_LIVE` /
    `SESSION_CONCURRENT_WRITER` / `SESSION_NOT_FOUND` / `SESSION_IMPORT_*` 各有专属文案，其余码显示宿主原文。
    并发写者折成「该会话正在别处运行；请先停掉那个实例，再重试这次操作。」，不显示库里的位点细节。

`src/ui/vendor/dsh-client-ui-chat/**` 是从上游按需复制的薄壳 fork（消息动作行 `MessageIconActions` 与它的
两个纯工具 + 样式），**行为逐行对应**：删文件与改 import 都按「可达集 + 类型从上游包名取」做，import 走本仓
口径，理由见下一条判据。

## 出口

| 出口         | 是什么                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------- |
| `.`          | 契约与默认实现（`SessionPersistenceRdb` / `SessionBranchRdb` / `SessionEditorDefault`）  |
| `./endpoint` | 两组 remote 契约（`sessionEditor` / `sessionAdmin`）、两端共用的类型、分支原语与配平算法 |
| `./server`   | 宿主面装配函数（`provideBetterSession` / `provideSessionBalance`）与端点实现             |
| `./ui`       | 浏览器面的装配函数与实现                                                                 |

## 判据

- 契约在 `src/contract`（进程内端口），remote 面在 `src/endpoint`，宿主实现在 `src/{data,admin,editor,storage}/**`、装配在 `src/server`；`src/` 根只有 `index.ts` / `cordis.ts`。
- 与 `@morlay/dsh-session-persistence` 的关系：那个包是**官方 jsonl 的适配**；本包是**替换实现**，
  只借它的 `SessionPersistence` 契约（同一个令牌，二选一），不重复它的行。边界与理由写在
  [`20261106-RDB复用边界与Remote端点形状`](./.agents/designs/20261106-RDB复用边界与Remote端点形状.md)。
- `src/ui/vendor/**` 的判据是**行为逐行对应、import 按本仓口径**：注释与实现保持上游形态；唯一例外是把
  type-only 的 `ChatViewSlotProps` 从上游包名取，省掉一整份 503 行的 `contract/slots.ts`。不在 vendor 里加
  我们的改动，也不留无人引用的上游文件。
- 验证接缝与守护 spec 见 [`how-to-verify`](./.agents/standards/how-to-verify.md)；
  `pnpm exec vitest run packages/agent-ex/better-session` 与
  `pnpm exec oxlint packages/agent-ex/better-session` 是这两条接缝的入口。
