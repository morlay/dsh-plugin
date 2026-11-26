# `RemoteResultWire` 跨包口径不一致（会话面裸值 vs 自研端点包装）

状态：未销账——`dsh-conversation` 的会话面（`session` 组）已是**裸值**（契约回裸值，客户端面 `faceOf` 那层用上游 `RemoteResult`）；`session-rdb` 的 `sessionAdmin` / `sessionEditor` 端点面仍在用本仓的 `RemoteResultWire`
位置：裸值一侧 `packages/agent/dsh-session/src/endpoint/session-endpoint.ts` + `packages/agent/dsh-conversation/src/ui/session-remote.face.ts`；包装一侧 `packages/agent-ex/session-rdb/src/endpoint/session-admin-endpoint.ts`（15 处）、`session-editor-endpoint.ts`（7 处）及它们对应的 `server/*.service.ts`

**现象**

同一个仓库里两种返回口径并存：

- **裸值**：`session` 组（以及 `commands` / `workspaceFiles`）——宿主是真相，`RemoteResult` 是客户端面 `faceOf` 的包装，不进契约；判据是 `AssertWireFace`（形参 + 返回双向）；
- **包装**：`sessionAdmin` / `sessionEditor` 的端点面——方法声明回 `RemoteResultWire<T>`，宿主实现自己包 `{ ok, value }`。

**影响**

写第二个消费方的人得先看那个端点属于哪一类，才知道要不要解包；跨组统一处理（通用重试 / 错误提示 / 按 `ok` 分派的中间层）会对其中一半失效。它也会让「守卫」这件事分叉：裸值那侧能对宿主类投影，包装那侧没有上游 wire 面可比。

**为什么暂并存**

那 3 个是**纯自研组**（`sessionAdmin` / `sessionEditor` / `sessionMode`，上游没有对应的 wire 面）：它们的判据是「descriptor 参数名 + 宿主入参映射」的 spec，而不是类型守卫。统一口径要等那批（19 个组的迁移收尾后的最后一个批次）做完，届时一起改裸值并补 spec。

**触发条件**

出现跨组统一的返回处理（重试 / 错误提示 / 中间层），或开始做那 3 个纯自研组的 spec 判据时。

**销账条件**

Done when：`rg -c 'RemoteResultWire' packages/agent-ex/session-rdb/src` 为 0，且那 3 个组各自有「descriptor 参数名 + 宿主入参映射」的 spec；`packages/agent/dsh-session/src/endpoint/session-endpoint.ts` 里仍然是裸值（不许反向统一成包装）。

**不修的理由**

`sessionAdmin` / `sessionEditor` 是管理面（编辑器 / 批量运维），没有上游协议可对齐；把它们的 `RemoteResultWire` 剥成裸值只是形状统一，可观察行为不变，而判据（spec）还没写——先改形状等于「没有判据的重构」。按纪律：一次一个包，这条等那批做完。
