# @morlay/ui-conversation-message-actions

`rewind / retry / recall / fork` 的**编排层**：在 `@morlay/session-branch` 的 provider 抽象之上组装完整功能（产品语义
对齐 [dsh-message-edit](https://github.com/Moeblack/dsh-message-edit)），并提供**浏览器半**（client bundle）：替换
`conversation.chat.node` 的 `user` / `steering` 渲染（在 user 消息行内直接挂编辑 / 重试入口），并覆盖
`conversation.composer.dock` 的 `stats` 行（composer 统计：修好的 token 口径 + `data-composer-stats`）。

## 用法

装配入口是聚合层 [`@morlay/better-session`](../../../bundles/better-session/README.md)：由它的 bundle patch 插入本包的行并注册
`ctx.sessionEditor`（本包自己没有 bundle patch，不作为独立 bundle 安装）。依赖 `ctx.sessionBranch` /
`ctx.sessionPersistence`（provider 由同一聚合层装配，如 `@morlay/session-rdb`）与 `ctx.sessions`；`agents` 可选，
缺失时重放退化为「已 durable 的就地版本」。

```ts
// host：装配后直接调服务
await ctx.sessionEditor.retry({ action: "retry", sessionId, turn: 2, cascade: "truncate" });
const result = await ctx.sessionEditor.retry({ sessionId, turn, cascade: "truncate" });
```

HTTP 面：`POST /session-editor`（注册面与页面侧路径口径见
[设计 20260917-编排层操作语义](./.agents/designs/20260917-编排层操作语义.md)）。

## 结论

edit / retry / reroll 就地重写**同一会话**（session id 不变），只有 `fork` 派生新 id；`recall` 只截断并把文本
交回 composer，由用户改后自己发
（[ADR 就地编辑重写同一会话而非新建会话](./.agents/adrs/20260917-就地编辑重写同一会话而非新建会话.md)）。

## 文档

- 操作语义全文（服务面 / 就地编辑 / agent 驱动 / 浏览器半 / 分层边界）：
  [设计 20260917-编排层操作语义](./.agents/designs/20260917-编排层操作语义.md)
- 决策：[`.agents/adrs/`](./.agents/adrs)（接管官方 `ui-conversation` 行、client bundle 单文件与 shadow 渲染、引用解析、
  编辑入口门控…）
- 接缝、测试落点与未覆盖：[本包规范 how-to-verify](./.agents/standards/how-to-verify.md)
- 整体设计：[设计 20260917-会话编辑闭环装配](../../../bundles/better-session/.agents/designs/20260917-会话编辑闭环装配.md)
