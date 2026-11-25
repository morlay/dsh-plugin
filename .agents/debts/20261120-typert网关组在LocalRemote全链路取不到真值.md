# typert 网关注册的组在 `LocalRemote` 全链路里取不到真值

## 现象

全链路 ui 用例（`bootTwoSided` + `clientWithTransport`）对**上游 typert 注册的组**（`terminal/*`、`settings/*`
这类由适配行在上游 `typert.remotes` 里登记的端点）调用时，拿到的是失败面：

```
{ ok: false, error: { code: "gateway/invoke-failed", message: "[remote] terminal/list 没有实现：检查对应的服务有没有注册它" } }
```

自研 `@RemoteGroup` 组（`job/*` / `workspace/*` / `session/*` / `commands/*` / `sessionMode/*` …）不受影响：
它们在 `RemoteHandlers` 路由表里，`hostInvokerOf` 直连即可。

## 已做的尝试

`hostInvokerOf` / `hostStreamOpenerOf` 增加了**回落**：`handlers.has(endpoint)` 为假且 host 装了
`TypertGateway` 时，改走 `gateway.dispatchWire(endpoint, { args }, signal, peer)` / `gateway.stream(...)`。
方向对（与线上「自研组走路由表、上游组走网关」同一口径），但这条链上还没打通。

## 待查

- `dispatchWire` 的 `peer` 形状：现在传的是占位的 `{ kind: "host" }`，`remoteAccess` 准入按资源判定，
  形状不对会被判成 `gateway/invoke-failed`（`peer` 的真实形状取 `InvokeRemoteRequest["peer"]`）；
- `dispatchWire` 的载荷形状：是否要 `{ args }` 一层、还是要上游的 `{ request }` 命名参数；
- `gateway.stream({ endpoint: { namespace, method }, args, signal, peer })` 的实参形状同样待核。

## 影响面（当前绕过方式）

- `dsh-shell/src/ui/__tests__/terminal-endpoints.spec.ts`：真值断言（`terminal/list` 回空表、`environment`
  回限制值）**未达成**，只保留了「面挂上」与「解析不到会话时结构化失败」两条行为判据；
- 其它 typert 组（settings / workspace-files / permission-presets …）的全链路真值用例同样受限，
  目前靠各自的 live spec（真 web server + websocket）覆盖。

## 不做的事

不为让它变绿去改断言，也不假造 `peer`——那会把「装配与 wire 的问题」重新藏起来，正是这轮改造要消灭的东西。
