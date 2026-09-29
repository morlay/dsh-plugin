# @morlay/session-branch

分支式会话编辑的**契约层**：数据层分支原语 `SessionBranchProvider`（`readBranchPrefix` / `forkFrom` /
`rewind`）与高层服务 `SessionBranch`（`ctx.sessionBranch`），接口形状见
[`src/provider.ts`](./src/provider.ts)。

## 用法

装配入口是聚合层 [`@morlay/better-session`](../../bundles/better-session/README.md)——本包没有自己的 bundle
patch，`session-branch` 行由它的 patch 插入；实现方是 [`@morlay/session-rdb`](../session-rdb/README.md)
（同一个后端也实现上游 `SessionHandle`）。

```ts
const boundary = await ctx.sessionBranch.readBranchPrefix(sessionId, userEventSeq, "before");
await ctx.sessionBranch.rewind(sessionId, boundary.seq);
```

- `readBranchPrefix(id, atSeq?, mode?)`：定位 `atSeq` 锚定的闭合 `turn/end` 边界并返回前缀；`mode: "after"`
  含目标轮（fork 语义）/ `"before"` 排除目标轮（编辑 / 重掷 / 重试语义）。
- `forkFrom(sourceId, options?)`：纯 append 派生新会话（`parentSession` / `seedLength`，seed = 边界前缀 +
  `seedSuffix`），不触碰源会话。
- `rewind(id, toBoundary)`：唯一的显式回退原语，事务整体提交或回滚；支持 live 会话（内存 log 截断 +
  派生缓存复位 + handle cursor / 继承前缀对齐，机制见 session-rdb 的
  [设计 20260917-分支能力](../session-rdb/.agents/designs/20260917-分支能力.md)）。

`session-branch/version` 事件的类型仍在 `src/types.ts`：它只用于识别旧会话里已落库的该事件，本仓库当前
没有生产方与消费者（[ADR-删除版本树投影并停止写版本效果](./.agents/adrs/20260920-删除版本树投影并停止写版本效果.md)）。
