# RDB 复用边界与 Remote 端点形状（better-session 的宿主半）

状态：**已实现**——`pnpm exec vitest run packages/agent-ex/better-session` 38 文件 / 377 通过；`pnpm exec oxlint packages/agent-ex/better-session` 干净。
范围：`@morlay/better-session` 宿主半的两个判断——**RDB 后端复用哪些既有面、只加什么**，以及 **wire 只有 remote、两组端点各自的形状**。
非目标：浏览器半（`./ui`，见 [设计 20260929-对话管理页](./20260929-对话管理页.md)）；读路径口径（[如何写读路径](../standards/rdb-读路径.md)）；会话数据层语义（归 `packages/agent/dsh-session` 与 `packages/agent/dsh-session-persistence`）。
关联：词义见[会话数据面术语表](../../../../agent/dsh-session/.agents/GLOSSARY.md)（会话 / live / cold）与[会话编辑术语表](../GLOSSARY.md)（会话编辑组 / 会话管理组）；[ADR-实现上游 SessionHandle 模型](../adrs/20260917-实现上游SessionHandle模型.md)、[ADR-分支面作为与上游 SessionHandle 平行的 provider 抽象](../adrs/20260917-分支面作为与上游SessionHandle平行的provider抽象.md)。

## 一、决定

| #   | 议题                | 决定                                                                                                                                           | 一句话理由                                                             |
| --- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1   | 落盘契约            | 直接用 `@morlay/dsh-session-persistence` 的 `SessionPersistence` 令牌（handle 模型）                                                           | 它是两端唯一的落盘契约；另立一份等于两套语义                           |
| 2   | 与官方 jsonl 的关系 | `SessionPersistenceDefault` 不复用：本包是**替换实现**，同一令牌由 `SessionPersistenceRdb` 实现，装配面二选一                                  | 一个令牌只能有一个提供者，替换不需要第三层抽象                         |
| 3   | 行级能力放哪        | 同一个实例再实现 `SessionRdbStore`（`src/contract/session-rdb-store.contract.ts`）+ `asRdbStore()` 探测                                        | 分支与管理面要的是行级能力；探测失败是**指名**的错误，不是 `undefined` |
| 4   | 事件                | 订阅 `@morlay/dsh-session` 的 `Events`（`SessionCreated` / `SessionEventAppended` / `SessionFlush` / `SessionDisposed`），本包不再定义同名事件 | 一份权威定义，签名分叉只在运行期露出来                                 |
| 5   | wire 形态           | 只有 remote：`sessionEditor` 与 `sessionAdmin` 两个组，动作由方法名定                                                                          | remote 的 `<组>/<方法>` 已是「名字即动作」，再带 `action` 等于两份真源 |
| 6   | 二进制与错误        | zip 以 base64 双向走 JSON；错误走 `RemoteResultWire` 的 `error.code`                                                                           | wire 没有状态码；客户端按码分派，不解析文案                            |
| 7   | 默认值的 home       | 配置默认值归 `@morlay/zephyr-rdb`（只在显式给值时带键）；后端身份的默认值归我们（写死 `public`）                                               | 身份必须稳定：跟着上游默认值走会让「同一份后端」的判据在升级后失效     |

## 二、现状事实

**复用的面（不重复造）**

| 面                                                                                            | 在哪                                                                                  | 怎么用                                                                                        |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `SessionPersistence`（handle 模型：`create` / `open` / `flush` / `stat` / `list`）            | `packages/agent/dsh-session-persistence/src/contract/session-persistence.contract.ts` | `SessionPersistenceRdb extends SessionPersistence`，令牌原样                                  |
| `SessionPersistenceDefault`（官方 jsonl 适配：`fromCordis(SessionPersistence, JsonlPlugin)`） | `packages/agent/dsh-session-persistence/src/session-persistence.service.ts`           | **不复用**——同一令牌的另一种实现                                                              |
| `SessionStore` / `SessionQuery` / `SessionProjectionStore` 契约                               | `packages/agent/dsh-session/src/contract/**`                                          | 注入取用；本包分别给出 `SessionQueryRdb` / `SessionBranchRdb` / `SessionProjectionCacheRdb`   |
| 会话事件 `Events` 命名空间                                                                    | `packages/agent/dsh-session/src/index.ts`（`Events`）                                 | 本包 `SessionPersistenceRdb` 上挂 `created$` / `event$` / `flush$` / `disposed$` 四个字段订阅 |
| `runPersistenceContract`                                                                      | `packages/agent/dsh-session-persistence/src/testing/contract.ts`（`./testing` 出口）  | 落盘契约套件直接跑到 RDB 实现上                                                               |

**本包新增（增量）**

1. `src/rdb/**`：11 张表的表定义（`entities/v3/**`：`sessions` / `events` / `session-events` / `session-counts` / `session-usage` / `event-usage` / `session-projcache-rows` / `storage-units` / `storage-records` / `persistence-state` / `schema-meta`）、读写路径（`read-path.ts` / `write-path.ts` / `live-routing.ts`）、迁移（`migrations.ts` / `legacy.ts`）、导入导出（`log/export.ts` / `log-import.ts`）、整理（`organize()` 的实现路径）、SQLite / PostgreSQL 开口（`db/open.ts`）。
2. `SessionRdbStore` 能力面：`branchPort()` / `readModel()` / `headerOf()` / 条件读（`selectSessionRows` / `selectEventRows`）/ `load` / `readFrom` / `append` / `listRows` / `deleteSession` / `importZip` / `organize` / `usageReport` / `archivedSessionIds` / `storageRepository` / `close`。
3. `branchPort()`（`src/rdb/branch/port.ts`）：分支只需「读前缀、截断、复用映射、确认位点」这几个动词，每个都有真实调用方，不是把服务方法表抄一遍。
4. handle 实现（`src/rdb/handles.ts` 的 `RdbSessionHandle` / `RdbBackendTracker`）与写者位点守卫（`src/rdb/write-guard.ts`）：pending 可见性、单写者所有权、flush 屏障、位点过期拒绝写入。
5. 两组端点契约（`src/endpoint/**`）与宿主实现（`src/server/**`）。

**wire 的两组**

| 组              | 方法                                                           | 载荷要点                                                                                                                                                                          |
| --------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sessionEditor` | `edit` / `reroll` / `retry` / `rewind` / `recall` / `fork`     | 会话 id + 事件位置（`seq` / 轮次）+ 新文本；返回「重建窗口」所需的会话标识                                                                                                        |
| `sessionAdmin`  | `rows` / `delete` / `import` / `export` / `organize` / `usage` | `rows`：`query` / `includeSubagents` / `page` / `pageSize`（默认 20，上限 200）；`delete`：只接受已归档会话；`import` / `export`：base64 zip；`usage`：`SessionUsageRange` 语义键 |

**字段名的两处口径**

- 会话 id 在 wire 上是裸 `string`，进业务前铸一次 `SessionId`：契约类型用 `string`，端口（`SessionBranch` / `SessionEditor`）用 branded `SessionId`。
- `SessionRowsItem` 没有 `subagent` 字段：子代理过滤是**请求**参数（`includeSubagents`），行上的子代理标记由页面按 `origin === "subagent"` 判——少一个恒为 `false` 的字段就少一处不一致。

## 三、模块边界与接口

| 模块                          | 拥有（职责与不变量）                                                           | 不拥有（明确排除）                                                 | 依赖方向                                                                      | 接缝 / 适配器                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `SessionPersistenceRdb`       | handle 契约的五个方法、行级能力面、live 写路由的接线、库的打开与身份           | 分支语义、查询语义、编辑编排；wire                                 | 依赖 `SessionPersistence` 契约、`SessionStore`、`SessionAgentControl`（可选） | `SessionPersistence` 令牌；`asRdbStore()` 探测；`src/rdb/**` 为内部实现                                                   |
| `src/rdb/**`（表与读写路径）  | 表定义与迁移、事件行与桥接行、统计与用量表、KV 域落库（`storage-takeover/**`） | 「会话现在是什么」的对外回答（归查询行）；编辑计划（归 `plan.ts`） | 依赖 `@morlay/zephyr-rdb`（表句柄、条件、方言）                               | 读写路径只经 `Backend` 面（`src/rdb/backend.ts`）                                                                         |
| `src/endpoint/**`             | 两个 remote 组的契约、两端共用的形状、分支原语与配平算法                       | 宿主实现；wire 传输                                                | 被 `./server` 与 `./ui` 同时依赖                                              | `@RemoteGroup` / `@RemoteMethod` + `RemoteResultWire`                                                                     |
| `src/server/**`               | 端点实现（转发）、装配函数 `provideBetterSession()`                            | 领域判断（全部落回实现类）                                         | 依赖契约与实现类                                                              | `registerRemoteGroup`                                                                                                     |
| `src/rdb/storage-takeover/**` | `rdb` storage 后端、投影检查点、`storages/*.json` 的一次性导入                 | 会话表的读写（归 `src/rdb/**` 的其余部分）                         | 依赖 `SessionPersistence`（拿同一个库的句柄）与 `ctx.storage`                 | `storage.backend.register` + `provide`（见 [设计 20261109-投影检查点…](./20261109-投影检查点与storage接管的两个名字.md)） |

**接口**（调用方要知道的）：

- `asRdbStore(persistence)`：`branchPort` 不是函数就抛「本装配的 sessionPersistence 不是 RDB 后端」——调用方不需要判空。
- `create()` 对已存在的 id 抛 `SessionAlreadyExistsError`；`open(id, "write")` 原子抢占写所有权，第二个写者被拒；`flush()` 是服务级屏障。
- `deleteSession()` 三条拒绝理由各带码：`SESSION_NOT_FOUND` / `SESSION_NOT_ARCHIVED` / `SESSION_LIVE`。
- `organize()` 返回 `{ orphanSessions, orphanEvents, rebuiltSessions }`，VACUUM 在其后。
- `storageRepository()` 是异步口：后端打开之后才有值，KV 域与会话表必须同一个库。

## 四、行为与边界

1. **正常路径**：`onInit` 里开始打开后端但**不等完**——坏库 / 版本不符 / 身份不符由第一次读报出来，装配照常起来。
2. **错误**：句柄的 `open` 在失败时释放写声明（`releaseClaim`）；导入超过大小上限直接拒；导出的会话不存在时抛「not found」。
3. **取消**：契约方法都收 `AbortSignal` 并 `throwIfAborted()`；取消不留下半个句柄（`open` 的 catch 释放声明）。
4. **生命周期**：`onDispose` → live 路由排水 → 关所有句柄 → 关后端；`close()` 与卸载同一条路径。
5. **并发与顺序**：写事务按「同一个库」串行（`open.ts` 的写队列键：sqlite 用路径、postgres 用连接串 + schema）；写者位点守卫拒绝过期位点的写入。
6. **默认值**：`openDatabase({ schema })` 只在用户显式给值时带这个键，默认值由 `@morlay/zephyr-rdb` 补；`storeIdentity` 与写队列键则用本行的解析值（`config.schema ?? "public"`）——身份不能跟着上游默认值漂。

## 五、验收判据

| #   | 判据（Done when）                                                  | 测试面（接缝）                            | 证据（命令 / 用例名）                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------ | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 包出口按包名解析得到，且 root 不导出装配函数与 `Events`            | `exports`                                 | `src/__tests__/exports.spec.ts`「包根出契约 + 默认实现（装配函数在 ./server，root 不 import server/）」「会话事件由域包提供（一份权威定义，订阅方从这里取）」                                                     |
| 2   | 落盘契约（所有权 / flush 屏障 / revision / 撕裂尾部）在 RDB 上成立 | `runPersistenceContract`                  | `src/__tests__/persistence-contract.spec.ts` 跑 `@morlay/dsh-session-persistence/testing` 的套件 + 本文件「readFrom 从指定 seq 起读」                                                                             |
| 3   | 两个实例的基准位点过期时拒绝写入，不是覆盖                         | `WriteGuard`                              | `src/__tests__/concurrency.spec.ts`「两个实例都 open 了写句柄，先写的那个提交之后，后写的被写者位点守卫拒绝」；`write-guard.spec.ts` 八条                                                                         |
| 4   | 后端身份的判据：同一份配置在同一数据根上重开仍是同一 revision 基   | `storeIdentity` + `stat`                  | `src/__tests__/persistence.spec.ts`「stat 只给 header 与 revision，list 把已落库的会话都列出来」；`multi-instance.spec.ts`「keeps the whole stored header across instances: the agent preset survives a restart」 |
| 5   | 两组端点的入参与返回值在 wire 上成立                               | `registerRemoteGroup` + `handlers.invoke` | `src/__tests__/endpoint.spec.ts`（`sessionEditor` 组 / `sessionAdmin` 组）                                                                                                                                        |
| 6   | 删除的三条拒绝理由各带码；整理三项计数；行列表分页                 | `SessionRdbStore`                         | `src/__tests__/admin.spec.ts`「删除只允许已归档且不在运行中的会话，三条拒绝理由各自有码」「organize 回收孤儿并重算派生统计，返回三项计数」「listRows 给完整语料（含 cwd / 时间 / 归档标记）并支持分页」           |
| 7   | 落盘真在文件里（进程外可恢复），坏库拒绝打开                       | `db/open.ts`                              | `src/__tests__/persistence.spec.ts`「删掉库文件后重启：会话不在了」「落盘在数据根下的 sqlite 文件里」；`recovery.spec.ts`「库里的结构版本不认识时拒绝打开」「默认配置落在 <数据根>/sessions/sessions.sqlite」     |
| 8   | 整包回归                                                           | 全包                                      | `pnpm exec vitest run packages/agent-ex/better-session` → 38 files / 377 passed                                                                                                                                   |

## 六、取舍

- **不做成第二份 `SessionPersistenceDefault`**：那是官方 jsonl 的适配；落盘这一层没有可转发的上游插件，全部是自己的实现。
- **不把分支塞进 handle 契约**：上游 handle 是 append-only，加截断 / 删除面就碰「上游不可修改」红线；分支因此是平行契约（[ADR](../adrs/20260917-分支面作为与上游SessionHandle平行的provider抽象.md)）。
- **不把行级能力做成独立令牌**：一个实例只能占一个令牌，而 `sessionPersistence` 已被上游契约固定；因此声明成普通接口 + 探测。
- **不保留 HTTP 路由**：本包不注册 `webServer` 的 exact 路由（`src` 里没有 `webServer` 引用），wire 只有 remote 一条路。
- **不搬引用展开**：源部署里 `@morlay/dsh-reference` 那几条行不装，对应的读面与用例一并不要。
- **归档 / 取消归档仍走 `uiWorkspace`**：那是 workspace 域的动作面，本包不重复提供；删除前的「先取消归档」只在装配里装了 `sessionArchiveRegistry` 时才做。
- **不设第二处默认值**：schema 的默认值归 rdbkit，后端身份的默认值归本行——判据是「生成 SQL 要用的事实」还是「标识同一份后端的键」。

## 七、不做与已知债

- PostgreSQL 方言不在本包测：本包用例只跑 SQLite，方言差异（连接、库身份、聚合的 int8、JSON 提取、本地日、事务串行、自定义 schema）由 `packages/zephyr/zephyr-rdb` 自己的用例覆盖。
- 用量统计的真实数值不在本包测：测试日志没有模型 usage 行，用例只断言形状与范围语义。
- `sessionArchiveRegistry` 目前没有提供方：装配里没有它时，列表退回持久化里的归档标记，删除不做「先取消归档」（`deleteSession` 的可选分支）。

## 八、开放问题

- `headerOf()` 只由 `SessionRdbStore` 契约承诺，包内没有调用方；首个需要「只读会话行」的消费方出现时它才是接线点。
- PostgreSQL 下的身份串含连接串：换连接方式（同一库走不同串）会被判成另一份后端。要不要按库身份（如 `pg_database_oid`）算，等真有多入口部署时再定。
