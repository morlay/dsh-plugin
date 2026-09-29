# 同 id 单写入者与并发写入 fail loud

状态：已采纳

背景：rdb 后端事件原样落库（[ADR-写路径零转换与原样存储](20260917-写路径零转换与原样存储.md)），而每个
`SessionPersistenceRdb` 实例只在内存维护自己的 handle cursor；两个后端实例（另一个 `dsh` 进程、或同一进程
内重复加载的持久化插件）共享同一数据库时，同一 session id 就可能被两个实例同时追加。

**决定**

**同一个 session id 同时只能有一个写入者**：后端记录每个 session「本实例最后确认的稠密 head」，`appendBatch`
在事务内校验磁盘 head 与该记录一致（`src/write-guard.ts:15`）；不一致（另一写入者提交过、或本实例从未读过该
session 却遇到已有行）时 **fail loud 拒绝**，而不是把本批次静默重编号到对方尾部。

**考虑过的选项**

- **静默重编号续接**：会把两组独立 turn 拼接成同一个 log，事件内容与 seq 语义全部错位——log 级损坏，
  而 `UNIQUE(f_session_id, f_sequence)` 拦不住（原样 seq 天然无冲突）。
- **跨实例协调器（分布式锁 / 租约）**：超出本后端职责。
- **写入前只比 revision、不比 head**：revision 只在写入时 bump，无法区分「本实例读到的是哪一代」，
  也抓不住另一实例在 open 与 append 之间提交的事件。

**后果**

- 不同 session id 的并发写不受影响（各自独立 head）——多进程部署时各实例各写各的 session 是受支持场景。
- 一个实例 open（或 HMR adopt）过某 session 后可以继续 append——那是一次明确授权、基于最新磁盘状态的续接；
  同 id 双实例「都 open 过再各自写」不支持（[设计 并发写入](../designs/20260917-并发写入.md)）。
- write open 的迁移重写同样先做这道校验（`src/index.ts:1144`），否则另一实例在 open 期间提交的事件会被重写
  静默丢掉。
