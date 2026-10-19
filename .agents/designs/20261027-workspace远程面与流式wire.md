# workspace 远程面与流式 wire

状态：**已实现**（判据：`workspace-follow-loop.spec.ts`、`workspace-host.spec.ts`、`workspaces-store.spec.ts`）
范围：`remote.workspace` 的 wire 形态与两端归属；`api-session/*` 事件频道清单。
约束：不改上游 `@deepseek-ai/*`；业务包只经出口互相引用；框架包不认识业务 namespace。

## 结论摘要

| 议题 | 结论 | 一句话理由 |
| --- | --- | --- |
| 列表数据面 | 走 `workspace/follow`（`mode: 'stream'`），**没有** `workspace/list` | 上游 descriptor 里只有 `follow`；baseline 之后还有 upsert/remove/order/archived/pinned 五种增量 |
| wire 流式 | `open` 帧按 endpoint 查流式路由表；每帧一条 `item`，自然结束发 `end`，客户端 `cancel` 或 socket 关闭则**不发** `end` | 与上游 `stream-server.pump` 的取消语义一致；上游 mux 协议本来就是「同一种帧、多次 item」 |
| 客户端流 | descriptor 的 `mode: 'stream'` 决定 `remote.<ns>.<method>` 返回逐帧面（`AsyncIterable` + `dispose`），不是 `Promise` | 生成面的类型就是 `RemoteStreamHandle`；把它当 unary 会让 `for await` 直接拿到一个 Promise 对象 |
| namespace 就绪 | `Remote.whenNamespace(name)`；`whenMounted()` 只等**第一个** contribution | session / workspace 是两次独立 `$mount`，等第一个会把后一个等成空态 |
| host 实现 | 复用上游 `WorkspaceController`（`fromCordis`），只补 wire 路由 | `WorkspaceFeed` 的增量与顺序逻辑已在上游；重写等于抄一份状态机 |
| 访问过滤 | 给上游的 `remoteAccess` 是常量 `{ allows: true }` | 本装配只有 owner 一条连接；`allows` 依赖的 `ctx.invocation` 在 `MuxServer` 这条路里不存在（[债](../debts/20261027-workspace-follow绕过上游调用上下文.md)） |
| slot 数据通道 | 渲染器的 `useXxx` / `useStore` 必须订阅源（`useState` + `useEffect`，且 `subscribe` 保留 `this`） | 上游组件只通过 hook 读数据；只取快照不订阅 = 折叠/拖拽/列表全部不响应（实测 `AppFrame` 的 `grid-template-columns` 永不变化） |
| 会话面形状 | `Sessions.retain` 返回完整 `SessionReference`（`sessionId`/`binding`/`ready`/`release()`/`dispose()`），契约补齐 `searchResultLimit`/`subagentAddress`/`search`/`fork` | `ui-workspace` 的 `restoreSelection` 直接调 `reference.release()`；缺成员是逐个运行时报错（`reference.release is not a function`） |
| 会话创建 | 装了 agent 行时由 `AgentLoop.create` 一次完成（prepare + 落盘 + enter + announce）；没装 agent 行时先落一条持久化 header（`id` + `cwd`）再 `attachSession` | `attachSession` 用 `sessionPersistence` 读 header 校验 cwd；只写内存会报 `session persistence holds no such session`。手填 header 现在只剩「没装 agent 行」的退化路径 |
| 行作用域 logger | `from-cordis` 把 `logger` 当**必需**依赖：`deps.logger`（`inject(Logger)`）优先，其次行 ctx，都没有就挂载失败 | 上游普遍 `ctx.logger.warn`；塞 no-op 会把上层的 warn 路径变成 `Cannot read properties of undefined (reading 'warn')`，错误还被业务层包成另一个错误（`workspace/invalid-path`） |
| `DomainFacility` 的宿主 ctx | 必须带 `logger`（`StorageDomainDefault` 里 `inject(Logger)`） | `DomainImpl.emitChanged` 在 `domain/changed` 监听器失败时 `ctx.logger.warn`；缺了会让**每次写 domain 都崩**，workspace create 半途失败并留下 `pendingMutation` |
| unary 结果 | 宿主注册处包成 `RemoteResult`（`{ ok: true, value }` / `{ ok: false, error }`）；流式帧不包 | 上游 client 面（`ClientWorkspaceModel`、`uiWorkspace.pickDirectory`）按 `result.ok` 解，裸值会让它们读到 `undefined`——取消一次目录选择后的 `Cannot read properties of null (reading 'ok')` 就是这么来的 |
| 客户端归属 | `@morlay/dsh-workspace`（`"."` = host 行，`"./client-module"` = 契约/实现/绑定） | 能力只有一个 home；出口命名跟本仓其它业务包一致（`client-module`） |
| 页面归属 | 侧栏 = 上游 `ui-sidebar`，工作区与会话行 = 上游 `ui-workspace` 的 `WorkspaceBrowser`，目录对话框 = 上游 `ui-directory-picker-browse`；自写视图只剩 `main` 空态 | 「样式与交互复用上游」是默认，只有与我们的契约不兼容时才部分重写 |
| slot 文案 | 渲染器按注册项的 `locale: NS` 调 Locale 面的 `bind(NS)` 生成 `t` | 上游组件把 `t('session.new')` 当文案；没有这层会渲染成 key |
| 事件频道 | `api-session/*` 五条（added/removed/status/activity/error） | 与上游 `session-controller/src/remote-events.ts` 一一对应；少一条那类变化永远到不了页面 |

## 入口与渲染归属

- **包出口**：`@morlay/dsh-workspace` 的 `"."`（host 行）与 `"./client-module"`（client 面），与 `@morlay/dsh-session` 的命名一致。
- **页面由上游渲染**：`ui-sidebar` 占 `sidebar` 并声明其全部子位置（它同时是「新建会话」按钮的 owner，走 `uiWorkspace.startSession()`）；
  `ui-workspace` 的 `WorkspaceBrowser` 占 `sidebar.workspaces`；`ui-directory-picker-browse` 填两个 `directory-flow` 洞。
  自写的 `SessionListView` / `NewSessionView` 已删除——它们与上游在同一个 single 位置上互斥，且只复制了视觉。
- **目录选择用 native backend**（与上游默认一致）：host 侧是上游 `NativeDirectoryPicker`（macOS AppKit panel 等），
  client 侧是上游无渲染的 `NativeDirectoryFlow`，拾取走 `uiWorkspace.pickDirectory()` → `remote.directoryPicker.pick()`。
  没有自己实现 picker；`browse`（应用内浏览）只适用于「远程客户端看不到宿主屏幕」的部署，本页面开在宿主上。
- **`pick` 的注入面必须引用稳定、且同一次选择只发一个请求**：上游 `NativeDirectoryFlow` 的 effect 依赖
  `[open, pick]`，每次渲染换新函数会让它在 `open` 抖动时反复触发；而 owner 假定 native 只会「成功/取消」，
  失败时会把 flow 重新打开。两个因素叠加就是刷屏的 `directoryPicker/pick`（真机上看到 `streamId` 涨到上千）。
  另：`pick` 只由 **native** backend 服务——backend 是 browse 时上游会以
  `directory-picker/unavailable`（"needs the native capability"）拒绝，那也会落进同一条重开路径。
- **唯一自写的一处是 slot 注册**：上游 `ui-directory-picker-native` / `-browse` 的 `apply` 把侧栏与
  `conversation.hero.workspace` 两个 directory-flow 洞绑成一个事务，外层要等 `conversation.hero` 的声明；那个位置
  属于上游 `ui-conversation`（位置只能由父条目的 children 表声明，`@View` 位置类声明不出来）。我们没装它，
  所以应用行只注册侧栏那个洞。装 `ui-conversation` 之后删掉这一行、回到上游 `apply`。
- **跨行注入 `uiWorkspace`**：上游把它建在 `ui-workspace` 那一行内部，`ui-sidebar` / `ui-directory-picker-browse` 是另外两行；
  应用层用 `InjectionToken("uiWorkspace")` 让 `UiWorkspaceRow` 双参 `fromCordis` 把服务发布成令牌，另外两行按令牌注入。
- **locale 缺口**（本轮修）：渲染器原先给 slot 条目的 `t` 是无条件 fallback（返回 key）。现在按 `entry.locale` 调
  `host.locale.bind(ns)`——上游 locale 行 `apply` 里本来就会 `ctx.slots.installLocale(locale)`。

## 事实基线

- 上游 descriptor 里 `workspace` 只有 `follow` 是流式，其余命令都是 unary 且参数名统一为 `request`：
  `vendor/deepseek-harness/packages/api/workspace-controller/lib/typert.remote-client.ts:352-368,276-330`。
- `follow` 的帧是 `baseline | replace | upsert | remove | order | archived | pinned`：
  `vendor/deepseek-harness/packages/api/workspace-controller/src/client/index.ts`（`createWorkspaceStateStream` 的 `acceptIncrement`）。
- 上游 mux 的流式与 unary 共用 `open` 帧，靠多次 `item` + 终帧区分；取消时不发终帧：
  `vendor/deepseek-harness/packages/api/gateway/src/stream-server.ts:214-286`。
- 五条频道名与载荷：`vendor/deepseek-harness/packages/api/session-controller/src/remote-events.ts`、
  `src/types.ts:609-636`。
- 客户端 store 的消费点：`WorkspacesDefault` 用上游 `ClientWorkspaceModel`（baseline/增量/快照缓存都在它里面），
  这里只接流与转发命令。

## 取舍

- **不自己实现 workspace 状态机**：`ClientWorkspaceModel` 已经处理了「unary 回声与流帧的先后」「removed id 不复活」
  这类竞态；抄一份就要连测试一起抄。
- **不为框架包引业务 namespace**：客户端绑定（`$mount(TYPERT_REMOTE)`）留在业务包的 client 出口，`zephyr-app` 只提供
  `Remote` 接缝。
- **host 行不用上游 gateway 的反射分发**：那条路要 `PeerScope` 与 `ctx.invocation`，而我们 `MuxServer` 自己握手、
  没有 admission；显式注册路由表是这套装配唯一可靠的真相来源。
- **`Remote.$stream` 仍是空实现**：上游的签名是 `{ name, open(signal), ended(accepted) }`，我们契约里写的是
  `{ name, args, signal }`。本轮没有消费方（`WorkspacesDefault` 直接用生成面的 `follow`），所以没动它；
  将来接 `ui-session` 的 journal 流之类时必须先把它对齐，否则那条流会静默拿到空迭代。

## 验证

```sh
pnpm exec vitest run packages/zephyr packages/agent apps/dsh-custom-next/src   # 69 files / 490 passed
pnpm exec oxlint packages/zephyr packages/agent apps/dsh-custom-next/src       # 0 errors
```

三处证据各自只管一段：`workspace-follow-loop.spec.ts`（真 WebSocket 的流式链路）、
`workspace-host.spec.ts`（host 用 mock client）、`workspaces-store.spec.ts`（client 用 mock server）。
