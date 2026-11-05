# 如何验证

通用规则（证据矩阵、失败处理、发布纪律）见根[如何验证](../../../../../.agents/standards/how-to-verify.md)；
这里只写本包的接缝、落点与环境门控。

命令入口：`pnpm exec vitest run packages/agent-ex/better-session`（整包 38 文件 / 377 通过）、
`pnpm exec oxlint packages/agent-ex/better-session`。测试都走**包名**
（`@morlay/better-session` / `@morlay/better-session/endpoint` / `@morlay/better-session/server`），
等于顺手守住 `exports`。

## 宿主半的接缝与守护 spec（`src/__tests__/`）

| 接缝                                     | 守护 spec                                                         | 判据                                                                                                                         |
| ---------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 包出口                                   | `exports.spec.ts`                                                 | 包根 / `./endpoint` / `./server` 按包名解析得到，且包根不导出装配函数与 `Events`                                             |
| 面的边界                                 | `boundaries.spec.ts`                                              | 浏览器半不引宿主半（也不引包根）；宿主半不引浏览器半                                                                         |
| `SessionPersistence` 契约（handle 模型） | `persistence-contract.spec.ts`                                    | 域里的 `runPersistenceContract` 跑在 RDB 实现上；另补「readFrom 从指定 seq 起读，读视图与整段读一致」                        |
| 落盘行为面                               | `persistence.spec.ts`                                             | 写进去原样读回来、落在数据根的文件里、`stat` / `list` 的口径、重复 `create` 被拒、删库后重启不在了、空会话要 `flush` 才物化  |
| 写者位点守卫                             | `write-guard.spec.ts`、`concurrency.spec.ts`                      | 过期位点拒绝写入（不是覆盖）；同一实例单写者；两个句柄写不同会话互不影响                                                     |
| 跨实例 / 多会话并发                      | `multi-instance.spec.ts`、`multi-session.spec.ts`                 | 同一 id 并发创建、交错多批 append 不串、fork 子会话并行落库 dense-intact                                                     |
| 写锁竞争                                 | `busy-timeout.spec.ts`                                            | `busyTimeout: 0` 立即失败（等价丢写）；非零时竞争变成排队                                                                    |
| 存储层自愈                               | `recovery.spec.ts`                                                | 撕裂尾部不外泄且能续写、导出可解析、整理后仍可读、结构版本不认识时拒绝打开、默认配置落在 `<数据根>/sessions/sessions.sqlite` |
| 旧格式与读视图                           | `rdb.spec.ts`、`legacy-shape.spec.ts`、`inbox-repair.spec.ts`     | 旧代消息形状归一、自有事件类型按 ignorable 跳过、孤儿 inbox splice 被修                                                      |
| 写入放大与读路径                         | `read-path.spec.ts`                                               | header 没变时不再 UPDATE、一批 append 只写一次会话行、`load` 只读一遍事件、rewind 的类型查询只取两列                         |
| 分支面                                   | `branch.spec.ts`                                                  | 锚定语义（`before` / `after`）、fork 不动父会话、rewind 后能继续追加、内存 log 镜像与派生缓存失效                            |
| live 路由                                | `live.spec.ts`、`live-failure.spec.ts`                            | 内存追加 → `flush` → 落库读得到；初始化失败是终态（后续事件丢弃且 `flush` 报错）                                             |
| 会话查询                                 | `query.spec.ts`、`session-query.spec.ts`、`session-title.spec.ts` | 列表不含归档、搜索显式失败、同一 revision 只读一次、一万条事件只物化命中行、标题从库读                                       |
| 管理面                                   | `admin.spec.ts`                                                   | 整理三项计数、删除的三条拒绝理由各自有码、`listRows` 分页与完整语料                                                          |
| 两组端点                                 | `endpoint.spec.ts`                                                | 装到 wire 上之后 `handlers.invoke("<组>/<方法>")` 的入参与返回值（含 `usage` 形状与 `organize` 停 agent）                    |
| 编辑计划与配平                           | `editor-plan.spec.ts`、`balance.spec.ts`                          | 撤回哪个回合、重放哪些用户输入、保留前缀不破 step 配对                                                                       |
| agent 目录面                             | `session-agent-control.spec.ts`、`session-retry-live.spec.ts`     | 有目录时先停 agent 再排队；没目录时只重写日志不抛；真 agent 下 retry 不进程退出                                              |
| 投影检查点                               | `projection-cache.spec.ts`                                        | 增量写回、同 tick 合并、撤回后的截断与两条兜底                                                                               |
| storage 接管                             | `storage-takeover.spec.ts`、`workspace-registry.spec.ts`          | KV 域落同一个库、KV 后端契约（双开拒绝 / 关前排水）、`storages/*.json` 一次性搬运、官方 registry 的归属与归档标记跨重启      |

## 浏览器半的接缝与守护 spec（`src/ui/**/__tests__/`，happy-dom）

| 接缝                              | 守护 spec                                                        | 判据                                                                                                                       |
| --------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 消息动作的入口门控                | `session-editor/user-message.view.spec.tsx`                      | 有文本块才有「编辑」；重试只对已闭合轮次；两入口都先确认；撤回回填全部文本块                                               |
| 消息动作打到哪                    | `session-editor/session-editor.store.spec.ts`                    | 端点名 `sessionEditor/retry` / `sessionEditor/recall` / `sessionEditor/fork`、成功后重建窗口而不整页重载、失败不阻塞下一次 |
| 编辑 / 重试 / 撤回 / 分叉的全链路 | `session-editor/session-editor.{edit,retry,recall,fork}.spec.ts` | 真宿主（`support/e2e-host.ts`）+ 真客户端（`support/e2e-client.ts`）+ DOM 渲染（`support/e2e-render.tsx`）跑通一条动作     |
| 管理页动作面                      | `conversation-manager/conversation-manager.controller.spec.ts`   | 端点名与请求形状、错误码透传、归档委托 `uiWorkspace`、导出落成下载                                                         |
| 管理页渲染                        | `conversation-manager/conversation-manager-page.spec.tsx`        | 列表 / 搜索 / 分页 / 子代理过滤、三种整屏状态、`data-*` 标注、统计三个维度                                                 |
| 浏览器半装配                      | `ui/__tests__/ui.provide.spec.ts`                                | 两条 chat-node 注册（`priority: -1`）+ 一对 `main` / `sidebar.panellist`；字典只注册一次                                   |

## 装配辅助

`src/__tests__/support/**` 的分层与判据见 [测试支撑的分层](./testkit.md)——**本文不复述**。要点只有两条：
宿主半的 spec 从 `support/host.ts` 的 `startHarness()` / `startHarnessWithAgent()` 起装配，
浏览器半的全链路 spec 从 `support/e2e-host.ts` + `e2e-client.ts` + `e2e-render.tsx` 起装配。

## 未覆盖（有明确原因）

- **PostgreSQL 方言**：本包用例只跑 SQLite（`RdbConfig` 的 postgres 分支没有 spec）。方言差异——连接、库身份、聚合的 int8、JSON 提取、本地日、事务串行、自定义 schema——由 `packages/zephyr/zephyr-rdb` 自己的用例覆盖；要在这里跑 PG 得先有那份 `TEST_PG_URL` 门控与建库辅助。
- **真实模型用量的数值**：`endpoint.spec.ts` 覆盖 `usage` 的形状、子代理拆分与范围语义，但测试日志里没有模型 usage 行——活动计数按「会话有用量行」的口径过滤，所以那些断言是全零。真实数值要在有模型事件的数据上才能验。
- **旧世代格式的迁移链**：`legacy-shape.spec.ts` 覆盖旧代消息形状的读取与 ignorable 跳过，但没有「跨世代逐版迁移」的用例——本包没有可造的旧世代数据。
- **内核级隔离**：本包不碰沙箱；Seatbelt / bwrap 的真机行为归 `packages/agent-ex/configurable-sandbox` 的规范。
