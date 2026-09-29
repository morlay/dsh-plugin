# @morlay/ui-conversation-message-actions

会话编辑的**编排层**：在 `@morlay/session-branch` 的 provider 抽象之上组装 **六个动作** `edit` / `retry` /
`reroll` / `recall` / `rewind` / `fork`（`ctx.sessionEditor`，HTTP 面一条 exact
`POST /session-editor`），并提供**浏览器半**（client bundle）：替换 `conversation.chat.node` 的
`user` / `steering` 渲染（user 消息行内挂编辑 / 重试入口），覆盖 `conversation.composer.dock` 的 `stats` 行
（token 口径 + `data-composer-stats`）。产品语义对齐
[dsh-message-edit](https://github.com/Moeblack/dsh-message-edit)。

## 用法

装配入口是聚合层 [`@morlay/better-session`](../../bundles/better-session/README.md)：由它的 bundle patch 插入
本包的行并注册 `ctx.sessionEditor`（本包没有自己的 bundle patch，不作为独立 bundle 安装）。依赖
`ctx.sessionBranch` / `ctx.sessionPersistence`（provider 由同一聚合层装配，如 `@morlay/session-rdb`）与
`ctx.sessions`；`agents` 可选，缺失时重放退化为「已 durable 的就地版本」。

```ts
const result = await ctx.sessionEditor.retry({
  action: "retry",
  sessionId,
  turn: 2,
  cascade: "truncate",
});
```
