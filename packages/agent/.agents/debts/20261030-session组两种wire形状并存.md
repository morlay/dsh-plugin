# `session` 组里两种 wire 形状并存

状态：触发中（`list` / `create` / `page` 回裸值，同组其余端点回 `RemoteResultWire`）

**现象**

`packages/agent/dsh-session/src/endpoint/session-endpoint.ts` 的 `SessionEndpoint` 一组方法里：

- `rename` / `selectModel` / `fork` / `search` / `modelCatalog` / `initializeDefaultModel` /
  `canOpenWorkspacePath` / `workspacePathApplications` / `prompt` / `cancel` / `updateQueue` 回
  `RemoteResultWire<T>`（`{ ok: true, value }` / `{ ok: false, error }`）；
- `list` / `create` / `page` 回裸值（`SessionListValue` / `SessionCreateValue` / `SessionPageValue`）。

原因是消费方：`packages/agent/dsh-session/src/ui/session-controller.service.ts` 的 `create()` / `refresh()`
直接读 `result.sessionId` / `result.ids` / `result.byId`，换成 `RemoteResult` 会当场读到 `undefined`。
所以当前是「两端都不包、正好对上」，契约上不是刻意设计。

**影响**

同一个 `@RemoteGroup` 上的两种解码方式，任何按组统一处理的路径（通用的 retry、错误提示、按 `ok` 分派的中间层）
都会在 `list` / `create` / `page` 上走错分支。写第二个消费方的人必须先读实现才知道该按哪种解。

**触发条件**

出现第二个 `session/list` / `session/create` / `session/page` 消费方，或任何按组统一包装/解包 `session/*` 的中间层。

**销账条件**

Done when：三个方法都回 `RemoteResultWire<T>`，且 `grep -rn "session/create 的响应不符合契约\|session/list 的响应形状不符合契约" packages/agent`
零命中（消费方改读 `ok` / `value`），`packages/agent/dsh-session/src/server/session-endpoint.service.ts`
里这一组不再有裸返回值。

**不修的理由**

一次改 1 处生产 + 12 处 spec + 契约 + 消费方（`ui/session-controller.service.ts` 的两处形状校验、`ui-workspace`
的 `restoreBlank` 链路），收益是「组内一致」而不是任何可观察行为——单独一个提交做，别混进功能改动。
