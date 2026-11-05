# `workspace/follow` 绕过上游的调用上下文（`remoteAccess.allows`）

**状态**：接受中。**触发**：`remote.workspace.follow` 在真装配里被调用时。

## 现象

上游 `WorkspaceController.follow` 用 `this.ctx.remoteAccess.allows(...)` 过滤结果，而 `allows` 读的是
**调用上下文** `this.ctx.invocation`：

```ts
allows(resource) {
  const invocation = this.ctx.invocation
  const principal = principalOf(invocation)
  if (invocation === undefined || principal === undefined) return true
  …
}
```

（`vendor/deepseek-harness/packages/api/remote-access/src/index.ts:235-245`）

在我们的行作用域里，`invocation` 不在上游 `static inject` 里，读它就是
`cannot get property "invocation" without inject`——不是返回 `undefined`。

## 现在怎么绕的

`WorkspaceControllerRow` 给上游的 `remoteAccess` 是一个常量对象：

```ts
remoteAccess: { allows: (): boolean => true }
```

（`packages/agent/dsh-workspace/src/workspace-controller.host.ts`）

语义上等价于上游「没有 invocation 时返回 true」，前提是本装配**只有 owner 一条连接**：`MuxServer` 自己握手、
不做 admission、不区分 peer。

## 为什么先接受

- 现在没有第二个 principal，过滤本来就不会拒绝任何东西；
- 正确做法要先给 `MuxServer` 一条「每次调用带 peer 上下文」的路（在 `dispatch` 里建 `PeerScope` 或至少把
  `ctx.invocation` 设到调用作用域上），那是 wire 层的结构调整，与本轮「接通数据面」不是一件事。

## 想收时怎么收

1. `MuxServer.dispatch` 为每条逻辑流/每次 unary 调用建一个调用作用域，把 endpoint 与 principal 写进
   `ctx.invocation`（上游 gateway 的做法见 `vendor/deepseek-harness/packages/api/gateway/src/index.ts` 的
   `prepareInvocation`）；
2. `WorkspaceControllerRow` 的 deps 改回真实 `RemoteAccess` 契约面；
3. 用非 owner principal 的用例验证 `follow` 会按 `allows` 过滤 baseline 与增量（上游 `WorkspaceFeed` 已有测试可对照）。
