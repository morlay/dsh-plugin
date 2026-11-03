# 接管 storages 到 rdb 语义表

状态：已采纳

背景：`$DSH_HOME/storages` 由官方 storage 栈产出（`storage-json` 介质 + `storage-domain` 域层），当前有两个
域——`session_projcache`（v7，per-record）：`session-projection-cache` 插件的投影 checkpoint，是**派生缓存**
（miss 只会退化为更长的日志尾重放）；`workspace`（v2，single）：`ctx.workspaceRegistry` 的**权威数据**
（记录顺序、显示顺序、归档集都不可从会话日志推导）。本包已经用 RDB 接管了会话日志与分支能力，只剩这两份数据
还在文件层：SQLite 场景下它们是同一份状态的两个介质，PostgreSQL 场景下更是本地文件与共享库不一致（多实例各写
各的 `workspace.json`）；此外 `workspace` 是 single 布局，任一会话 attach / detach 都会原子重写整个文档。
上游 0.2.1-alpha.1 起又多了一个 **`schedule`（v1，single，一张 `tasks` 表、无 global）**：`dsh-schedule` 的
Host 提醒数据，由 web-app 在每份 profile 里挂的那一行打开——`storage-domain` 的 backend 已路由到 `rdb`，
没人服务这个域时那一行装载即报 `serves only the 'workspace' domain`。

**决定**

**这些域的数据落进与会话日志同库的语义表，官方文件介质整条禁用**：投影缓存由本包提供同名
`ctx.sessionProjectionCache` 服务，workspace 域保留官方 registry 行为、只把介质换成 rdb KV 后端。

1. **投影缓存服务级替换**：禁用官方 `session-projection-cache` 插件，由本包提供同名服务
   （`src/storage-takeover/projection-cache.ts`），公开面与语义逐一对齐上游（`cachedSnapshot` /
   `cachedPredecessorTitle` / `hydratePrepared` / `write` / `coldSnapshot`，三个强制写点 + 计数 / 定时节流，
   identity 校验与 `asOfSeq` 取最低水位）。checkpoint 只落**行级表** `t_session_projcache_row`（每个投影 key
   一行，`f_ver` / `f_seq` / `f_val`）；日志 identity 与会话行 1:1，直接复用 `t_sessions` 的 `f_version` /
   `f_created_at` / `f_cwd` / `f_seed_length`，不另存记录头。读方法是同步签名（session 列表在请求路径上直接
   调用）：**SQLite 直读表**（`readProjcacheDirect`，启动不做全表加载、外部写入立即可见）；PostgreSQL 驱动
   异步，只有该后端保留写穿镜像来支撑同一签名。
2. **workspace、schedule 与 cua 授权三域只换介质**：保留官方 `workspace` 插件、官方 `dsh-schedule` 行与
   官方 `cua` bundle（行为零漂移），由本包在 storage hub 注册 `rdb` KV 后端
   （`src/storage-takeover/storage-backend.ts`），实现上游 `StorageBackend.kv` / `KvUnit` 契约并把域映射到
   语义表（`workspace` / `schedule` 各一个显式映射）；`storage-domain` 的 backend 路由改为 `rdb`。KV 这层
   名字来自上游 storage-domain 的扩展点，不是本包引入的概念。
   上游 `cua` bundle（`dsh-cua` 的 `permission-store.ts`）另开一个**名字按 profile 派生**的授权域：域名是
   `cua_permissions_<profile 真实目录的 sha256>`、`tables: {}`、只有一个 global 槽，每次决策在 profile
   文件锁内整值 `set`。这类域与其它域一样落 `t_storage_records`：**域名就是行键**，不按域名白名单认——
   上游再加同类域不必动这里。
3. **域存储只有一份文档，不按域拆表**：所有域按 `(域, 表, 键)` 一行落 `t_storage_records`，值是上游
   `KvUnit` 那一份记录文档；global 单例用空表名 / 空键。所以 backend 只有一个 KV unit 实现，**上游再加一个域
   （不论它自带几张表、还是只有 global）都不需要再加表或映射**——域名是行的一部分。旧版按域拆的
   `t_workspaces` / `t_workspace_sessions` / `t_workspace_state` / `t_schedule_tasks` / `t_storage_globals`
   不再读写，启动时一次性搬进本表（旧表保留可回退，见第 5 条）。
   只有**会话行自己的派生标记**仍留在 `t_sessions` 上，由 workspace 域写入时写穿：归档 `f_archived_at`、
   钉住序号 `f_pinned_seq`（列表的 archived 与钉住顺序、删除路径都按会话查）。它们是会话语义的一部分，
   不是域存储的第二份事实——域文档仍是唯一来源，这两列只是它的投影。
   投影 checkpoint 不在域存储里：它由本包同名服务读写，仍落 `t_session_projcache_row`（派生缓存，按
   `(会话, 投影 key)` 一行）。会话标题仍物化在 `t_sessions.f_title` / `f_title_seq`（列表消费在 checkpoint
   行缺 title 时直接取该列）。
4. **禁用官方文件介质**：`bundles/better-session/cordis.patch.yml` 禁用 `storage-json` 与
   `session-projection-cache`，并把 `storage-domain` 的 config 覆盖为 `{ backend: rdb }`（patch 按 id 替换整段
   config）。
5. **旧数据显式导入**：包内 API `importStorages(repository, { dshHome })`（`src/import-storages.ts`，无 CLI /
   无对外导出，用例见 `src/__tests__/storage-takeover.spec.ts`）把旧 JSON 写进同一张表（`workspace` 域的
   记录与 global）；旧文件保留不删。上一版拆出来的语义表也在启动时一次性搬进同一张表
   （`src/storage-takeover/legacy-domain-migration.ts`，`t_schema_meta` 的标记保证只搬一次）。
   projcache 可以不导入（派生缓存会重建），导入只为保住首屏冷读性能。cua 授权域的旧 JSON 文档不在导入
   范围（应用级 `allowedApps` 由上游 store 一次性导入，会话级决定需重新授权），见
   [债-cua授权域的旧JSON未导入](../debts/20261102-cua授权域的旧JSON未导入.md)。

6. **禁用官方文件介质**：`bundles/better-session/cordis.patch.yml` 禁用 `storage-json` 与
   `session-projection-cache`，并把 `storage-domain` 的 config 覆盖为 `{ backend: rdb }`（patch 按 id 替换整段
   config）。
7. **旧数据显式导入**：包内 API `importStorages(repository, { dshHome })`（`src/import-storages.ts`，无 CLI /
   无对外导出，用例见 `src/__tests__/storage-takeover.spec.ts`）把旧 JSON 写进同一批表；旧文件保留不删。
   projcache 可以不导入（派生缓存会重建），导入只为保住首屏冷读性能。cua 授权域的旧 JSON 文档不在导入
   范围（应用级 `allowedApps` 由上游 store 一次性导入，会话级决定需重新授权），见
   [债-cua授权域的旧JSON未导入](../debts/20261102-cua授权域的旧JSON未导入.md)。

**考虑过的选项**

- **继续用文件介质、只把 workspace 域改成 per-record 布局**：PostgreSQL 场景下多实例仍各写各的文件，
  而且要给上游 storage-domain 加一种新布局（上游只读，改不了）。
- **投影缓存保留官方插件、只换文件路径**：它仍会打开第三个介质文件，SQLite 场景下会话状态散在两处。
- **把 workspace 域也改成 RDB 原生服务（替换 registry）**：registry 是上游服务，替换等于 fork 一份实现，
  而这里的诉求只是换介质。
- **通用 KV 兜底（什么 unit 名都收）**：表结构要显式维护，未知 unit 名直接报错更安全。

**后果**

- `$DSH_HOME/storages` 不再产生或更新文件；PostgreSQL 场景下 workspace 与投影 checkpoint 随库共享，
  多实例不再各写各的。
- 域存储只剩一份文档：`(域, 表, 键)` 一行，读是 `loadAll`、写是行级 upsert；新增域不需要加表或映射。
  代价是列表/搜索里「按 workspace 标题」这类查询要先在 host 端从文档建索引（workspace 数量级小），
  归档与钉住仍写穿到 `t_sessions` 的列（列表与删除按会话查）。
- 表结构与上游域 spec 版本绑定（projcache v7、workspace v2、schedule v1、cua 授权 v1）：上游升级域版本时需要
  同步适配（迁移 + 记录映射），当前由 `t_storage_units` 的版本戳 fail loud 暴露不匹配。
- 存储层类型直接复用上游契约（`WorkspaceRecord` / `WorkspaceDomainState` / `ScheduleTask` / `CheckpointIdentity` /
  `ProjectionCheckpoint`，全部 `import type`，运行时零依赖）：上游 spec 变化在编译期暴露，本包不复制一份结构
  定义（`src/storage-takeover/types.ts` 只声明 `StorageRepository` 接口与「上游类型 + 会话键」的组合）。
- `rdb` KV 后端服务**所有** storage 域（统一落 `t_storage_records`，域名是行的一部分）：不再按域名
  白名单认，也不再有「域 → 表」的映射清单；写未声明的表、或给没有 global 的域写 global 仍 fail loud
  （那是调用方违约）。
- cua 授权域的写入是**整值文档替换**（上游每次决策整份 `set`）：一份 profile 一行、不拆列——那份对象只有
  Computer Use 自己消费（权限页读全量），拆列没有第二个读法。域名的摘要就是隔离键：同一份库里不同 profile
  各占一行，互不可见；profile 目录搬家会换域名，旧行不再被读到（与官方 JSON 介质换文件名同形）。
- cua 授权的串行化仍归上游的 profile 文件锁：同一台机器上多进程安全（每次决策重新开域、读最新值再整值写）；
  多台机器共用同一个 PostgreSQL 库时「读-改-写」没有跨主机互斥，最后写入者赢——上游本来就不支持跨主机
  共享授权状态，这里不额外加锁。
- 归档标记落在会话行上：live 但从未物化的会话归档时补一行骨架（head = -1、无 cwd / seed），标记立即可落；
  该会话后续真正物化走 `upsertSession`，其冲突列不含 `f_archived_at`，标记继续保留（组合回归用例锁定
  「归档 → 物化 → 重启」）。
- PostgreSQL 的 storages 写事务用 `serializable` 隔离级别：workspace 域是整记录替换，多实例并发写同一记录时
  冲突以序列化失败暴露，而不是 read committed 下「最后提交者赢」的静默覆盖——与「并发写入 fail loud」一致，
  调用方重试即可（[设计 并发写入](../designs/20260917-并发写入.md)）。
- 读路径直读介质（SQLite）：`cachedSnapshot` 系列同步查表，进程里不再有第二份 checkpoint 表；PostgreSQL 因
  驱动异步保留写穿镜像，重启或他实例写入读作 cache miss（与官方 json 介质的行为等价）。
