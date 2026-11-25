# `session` 契约的请求/响应**类型**与上游 wire 不符（wire 侧两处未修；服务面那一处已修）

状态：**部分销账**——`SessionController.list`（服务面）已按上游 `SessionListState` 对齐；wire 侧的 `SessionListValue` / `SessionPageRequest` 与 `sessions.provide.ts` 的注释仍未修
位置：`packages/agent/dsh-session/src/endpoint/session-endpoint.ts`（`SessionListValue`、`SessionPageRequest`/`SessionPageValue`）；wire 真相见 `vendor/deepseek-harness/packages/api/session-controller/lib/typert.host.ts` 的对应 schema 与 `src/types.ts`

**现象**

宿主实现是上游 `SessionController`（`packages/agent/dsh-conversation/src/server/api-session.provide.ts` 的 `ApiSessionControllerHost`），所以 wire 形状以上游为准；我们的契约手抄过三处不一致：

1. `SessionListValue` 声明成 `{ ids, byId }`，上游 `session/list` 实际回 `{ items: SessionSummary[] }`；
2. `SessionPageRequest` 声明成 `{ sessionId, throughSeq }`，上游是 `{ address, throughSeq, beforeSeq, maxMessages, turnWindow }`（`address` 是 `{kind:'session'|'subagent',…}`）；
3. `packages/agent/dsh-conversation/src/ui/sessions.provide.ts` 的注释写「那份由 `provideClientRemote()` 挂」——那个函数只装 `RemoteDefault`（`packages/zephyr/zephyr-app/src/client/remote/provide.ts`），不挂任何 descriptor（descriptor 由 `SessionEndpointClient.onInit` 挂上游那份 `SESSION_CONTROLLER_REMOTE`）。

**已销账的第 4 处（同一类问题，服务面）**：`SessionController.list` 曾声明我们自己的 `SessionCatalog`（`{ ids, byId, phase: 'loading'|'ready'|'failed' }`、行是 `unknown`），而上游 `ISessions['list']` 是 `ObservableSnapshot<SessionListState>`（`phase: 'pending'|'ready'`、行是 `SessionSummary`）。只核键的覆盖守卫看不见，改成 `AssertCoveredStrict`（签名级）后编译期就红。修法是**删掉那层重映射**：`SessionControllerDefault.list` 直接返回上游 `ClientSessions.list`，四个手抄类型（`SessionCatalog` / `SessionCatalogState` / `SessionScope` / `SessionView` / `SessionRetainHandle`）改成上游的别名。

**影响**

按契约类型写的新消费方会读 `list.ids` / 传 `page.sessionId`：运行期拿到 `undefined`（或宿主回 `not-found`），且没有编译期提示。这不是「组内两种包装」那一类（见 [`20261030-session组两种wire形状并存.md`](./20261030-session组两种wire形状并存.md)），而是**类型与 wire 说的是两件事**。

**为什么 wire 侧这轮没修**

wire 侧的这两处**没有任何类型守卫能看**：`SessionEndpoint` 是 `@RemoteGroup` 契约，descriptor 已经改挂上游那份（`endpoint/session-controller.remote.ts`），但契约里手抄的请求/响应类型只被客户端的 `SessionEndpointClient` 用于**类型**，运行期由上游 `ClientSessions` 按上游形状消费。要对齐得先确认上游 `SessionSummary` 的必填字段与 `address` 的两个分支，并把 `dsh-session` / `dsh-conversation` 里所有读这两处类型的替身与 spec 一起改——与「让目录能读出来」不是一件事，混做会把判据摊薄。

**触发条件**

新增任何直接读 `SessionEndpoint.list` / `page` 返回值的消费方，或把这份契约当成「wire 形状说明」转给别人时。

**销账条件**

Done when：`SessionListValue` 与 `SessionPageRequest` / `SessionPageValue` 按上游 `src/types.ts` 对齐（或改成直接 `import type` 上游类型），且 `sessions.provide.ts` 的注释改成「descriptor 由 `SessionEndpointClient.onInit` 挂上游那份 `SESSION_CONTROLLER_REMOTE`」；`grep -rn "readonly ids: readonly string\[\]" packages/agent/dsh-session/src/endpoint/session-endpoint.ts` 零命中。
