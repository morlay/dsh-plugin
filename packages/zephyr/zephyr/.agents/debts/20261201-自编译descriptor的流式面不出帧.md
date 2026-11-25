# `remoteDescriptorsOf(<Endpoint>)` 的流式面拿不到首帧

状态：未销账
位置：`packages/zephyr/zephyr-app/src/remote/decorators.ts` 的 `remoteDescriptorsOf`（descriptor 编译）与会话/工作区域的流式挂载（`Remote.$mount` → `remote.<组>.follow()`）

**现象**

同一个流式方法，用**上游** `TYPERT_REMOTE` 挂载时正常出帧；换成我们自己 `@RemoteGroup` 契约经
`remoteDescriptorsOf(<Endpoint>)` 编译出的 descriptor 后，`remote.<组>.follow(signal)` 拿不到任何一帧，
测试在 15s 超时（`mockTransport` 的 `openStream` 看起来没被调用）。复现路径：纯 node + `mockTransport` +
`ClientConnectionDefault(origin: http://127.0.0.1:1)` + `provideClientRemote()`。

**为什么记得下**

`remoteDescriptorsOf` 是我们自己组的唯一挂载来源（上游 `TYPERT_REMOTE` 已按分层搬走，见
`packages/zephyr/zephyr-app/.agents/designs/20261124-层能力清单.md`）。如果自编译 descriptor 的流式面不工作，
那所有**自研组**的流式方法（`session/follow`、`session/control`、`workspace/follow` 之外的 `@RemoteGroup` 组）
在客户端都拿不到帧——这是能力缺陷，不是测试问题。

**影响面**

自研组的流式方法：`session/follow` / `session/control`（会话域）、`toolResults`（对话域）、`session/terminal` 之外
各域的 `mode: "stream"` 方法。目前它们能跑是因为宿主侧 `registerRemoteGroup` 注册的是我们的组、而客户端
仍走 `Remote.$stream` 的旧路（`LiveSessionRemotes.$stream`）；一旦有人只依赖 `remote.<组>.<流方法>()`，就会拿不到帧。

**待查方向**

1. `remoteDescriptorsOf` 产出的 `parameters`（流式方法按形参个数全叫 `request`）与流式 face 的实参映射是否对得上；
2. `$mount` 为自编译 descriptor 生成的动态面，是否把 `mode: "stream"` 的方法接到了 `openStream`（而不是 `invoke`）；
3. `mockTransport.openStream` 的 endpoint 键与客户端实际使用的键是否一致（`<组>/<方法>`）。

**触发条件**

任何**只靠** `remoteDescriptorsOf` 挂载的组去调流式方法时（新增流式方法的组、或把现有流式方法统一改走这一条路）。
