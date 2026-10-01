# @morlay/better-session

profile 聚合 bundle：一次性装配 `@morlay/session-branch`、`@morlay/session-rdb`、
`@morlay/ui-conversation-message-actions`、`@morlay/ui-conversation-manager`、`@morlay/dsh-reference` 到 DeepSeek
Harness 的 profile，提供**就地编辑 / 重试 / 撤回 / 分支**（rewind / retry / recall / fork）闭环。对话外壳走**官方
`ui-conversation` 行**，我们的扩展只注册在它的槽位上（`conversation.chat.node` / `conversation.composer.dock`）。

## 安装

```sh
dsh plugin --profile web add "@morlay/better-session"
```

安装带上全部子包，bundle patch（[`cordis.patch.yml`](./cordis.patch.yml)）自动装配四层服务，并把官方
`session-persistence-jsonl` / `storage-json` / `session-projection-cache` / `session-query-sqlite` 那几行换掉
（对话 UI 行不动）。装了什么、为什么这么换、边界在哪，见
[设计 会话编辑闭环装配](./.agents/designs/20260917-会话编辑闭环装配.md)与
[ADR 不 fork 上游前端组件](../../../.agents/adrs/20261001-不fork上游前端组件只做插槽扩展.md)。

## 使用

装配后即可在 GUI 会话中：

- **编辑** user 消息 → 撤回该消息及其后内容到输入框（rewind，不重放），用户改后自行发送（带确认弹窗）
- **重试** 任意闭合回合 → 就地重放该回合输入（带确认弹窗）
- **分支**（fork）→ 从任意闭合边界派生**新会话**

也可以直接调用服务：

```ts
// 编排层（host）
await ctx.sessionEditor.retry({ action: "retry", sessionId, turn: 2, cascade: "truncate" });
// 数据层
await ctx.sessionBranch.rewind(sessionId, 5);
await ctx.sessionBranch.forkFrom(sourceId, { atSeq: 6, childSessionId });
```

## 配置（rdb）

默认配置为 SQLite（`$DSH_HOME/sessions/sessions.sqlite`）。改配置就是改这一行的 config（bundle patch / profile
patch / 设置页都可）：

```yaml
- id: session-rdb
  name: "@morlay/session-rdb"
  config:
    type: sqlite # 或 postgres + connectionString
    path: /abs/path/to/sessions.sqlite
```

上游 settings 只投影 volatile 字段做表单编辑，改动持久化回 entry config，不再覆盖插件 config，见
[ADR-20260922-跟随上游session-format-v4](../../session/session-rdb/.agents/adrs/20260922-跟随上游session-format-v4.md)。
