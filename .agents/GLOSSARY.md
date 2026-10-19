# 会话编辑（跨包词汇）

这份术语表只管**跨包共享**的词——契约层 / 编排层 / 实现层 / 聚合层与会话 UI 扩展共用的语言：
在不修改上游 `@deepseek-ai/*` 的前提下，重写同一会话或从闭合边界派生新会话。
只在一个包里成立的词住在那个包的 `.agents/GLOSSARY.md`（
[持久化坐标](../packages/session/session-rdb/.agents/GLOSSARY.md) ·
[编排面](../packages/session/ui-conversation-message-actions/.agents/GLOSSARY.md) ·
[装配面](../packages/bundles/better-session/.agents/GLOSSARY.md)）；
上下文边界见 [`GLOSSARY-MAP.md`](./GLOSSARY-MAP.md)，分层与设计背景见 [`系统设计`](./designs/20260917-系统设计.md)。

## 术语

### 装配

**装配（assembly）**：
把契约 / 编排 / 实现三层一次性装进 DeepSeek Harness web profile 的动作——归聚合层
`@morlay/better-session`（装了什么见其 [`cordis.patch.yml`](../packages/bundles/better-session/cordis.patch.yml)）。
_避免使用_：接线、wiring

### 会话与编辑

**会话（Session）**：
DeepSeek Harness 中由事件日志 + surface 构成的对话实体，以 session id 标识。
_避免使用_：对话、聊天记录

**就地编辑**：
edit / retry / reroll 的语义：rewind 截断到闭合边界后重写**同一会话**，
session id 不变。
_避免使用_：原地修改、in-place

**撤回（recall）**：
把已落定 user 消息从会话截断（rewind），文本交回输入框由用户修改后重新
发送——只截断、不重写、不重放、不产生版本效果。**尚未落定的排队消息**用同
一个词、成本不同：把该条移出队列（`remove`）后把原文交回输入框，不触碰会话
记录，所以不需要确认对话框。
_避免使用_：撤销、undo

**分支（fork）**：
从任意闭合边界派生**新会话**（纯 append，不触碰源会话）——唯一产生新
session id 的操作。
_避免使用_：复制会话、clone

**轮次（turn）**：
从 `turn/start` 到 `turn/end` 的对话回合，包含一条用户消息与若干助手消息。
_避免使用_：回合、round

**闭合边界（closed boundary）**：
已落定 `turn/end` 的轮次边界——fork 派生的唯一合法锚点；rewind 另接受
`user/message`（排除该消息的截断）与 `-1`（空前缀）。
_避免使用_：检查点、checkpoint

### 版本与血统

**版本效果（version effect）**：
`session-branch/version` 事件记录一次分支操作（edit / reroll / retry /
fork / rewind）的目标轮次、变更前后文本与逆操作；它的类型定义只用来识别既有会话里
这一类事件，写侧不产出、读侧不参与投影
（[ADR-删除版本树投影并停止写版本效果](../packages/session/session-rdb/.agents/adrs/20260920-删除版本树投影并停止写版本效果.md)）。
_避免使用_：版本事件、变更记录

**ignorable 事件**：
携带 `ignorable: true` 信封、可被读者安全跳过的事件——**原样落库**、读侧凭信封
决定是否参与投影。哪些事件被封这个信封、登记规则是什么，见
[设计 自造事件类型的信封](../packages/session/session-rdb/.agents/designs/20260924-自造事件类型的信封.md)。
_避免使用_：瞬时事件（瞬时事件是另一概念）

**seed（种子）**：
派生会话的初始事件前缀：边界前缀 + 可选 `seedSuffix`（手工回合）。
_避免使用_：初始状态、initial state

### 会话状态

**live 会话**：
驻留内存（`ctx.sessions` 有 owner）的会话——rewind 就地截断内存 log，并
复位派生缓存、对齐 handle cursor 与继承前缀（`resetAfterRewind()`）。
_避免使用_：活动会话、打开中的会话

**cold 会话**：
仅持久化、无内存 owner 的会话——rewind 后经 load 重新 adopt。
_避免使用_：离线会话、已关闭会话

**重放（replay）**：
把排队用户输入经 agent `followup` 驱动重放（live 直接排队；cold 先
resume）。
_避免使用_：重生成、regenerate
