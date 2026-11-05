# `session` 组里两种 wire 形状并存（`list` / `create` / `page` 回裸值）

状态：未销账——契约里三个方法回裸值，同组其余方法回 `RemoteResultWire<T>`；消费方的 `unwrap` 两种口径都认
位置：`packages/agent/dsh-session/src/endpoint/session-endpoint.ts`（`SessionEndpoint` 的 `list` / `create` / `page`）；消费方口径见 `packages/agent/dsh-skill/src/__tests__/support/wire.ts` 的 `unwrap`

**现象**

同一个 `@RemoteGroup({ name: "session" })` 上有两种解码方式：

- `list` / `create` / `page` 的返回类型是裸值（`SessionListValue` / `SessionCreateValue` / `SessionPageValue`）；
- `rename` / `selectModel` / `fork` / `search` / `modelCatalog` / `prompt` / `cancel` / `updateQueue` 等回 `RemoteResultWire<T>`（`{ ok: true, value }` / `{ ok: false, error }`）；
- 上游 descriptor 的类型是三个方法都回 `Promise<RemoteResult<…>>`（`vendor/deepseek-harness/packages/api/session-controller/lib/typert.remote-client.ts` 的方法表），而经 `typertGateway` 分派的 `@Remote` 方法实际回裸值——所以 `packages/agent/dsh-skill/src/__tests__/support/wire.ts` 的 `unwrap` 必须**两种口径都认**。

**影响**

任何按组统一处理的路径（通用重试、错误提示、按 `ok` 分派的中间层）都会在这三个方法上走错分支。写第二个消费方的人要先读实现（或读 `wire.ts`）才知道该按哪种解；契约因此不能单独当作形状说明。

**触发条件**

出现第二个读 `session/list` / `session/create` / `session/page` 的消费方，或任何按组统一包装 / 解包 `session/*` 的中间层时。

**销账条件**

Done when：三个方法在契约上都回 `RemoteResultWire<T>`，消费方与测试改读 `ok` / `value`，且 `grep -rn "list(): Promise<SessionListValue>\|create(_request: SessionCreateRequest): Promise<SessionCreateValue>" packages/agent/dsh-session/src/endpoint/session-endpoint.ts` 零命中。

**不修的理由**

这三个方法当前没有生产消费者：浏览器半走上游 `ClientSessions`（`packages/agent/dsh-conversation/src/ui/session-controller.service.ts`），本仓只用到 `prompt` / `cancel` / `updateQueue` / `rename` 四条（`packages/agent/dsh-conversation/src/ui/session-remote.face.ts`）。改契约要先确认上游 gateway 对这三条的真实包装，再同步改 `wire.ts` 的口径与相关 spec——收益是「组内一致」，不是任何可观察行为，所以单独一个提交做，别混进功能改动。
