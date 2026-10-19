# 页面加载时一批 `session/follow` 报 `no such session`

状态：触发中（实机可见：`agent-browser console` 里 30+ 次 `gateway/invoke-failed: session/follow: no such session`）

**现象**

`just web` 起来后打开页面，客户端对侧栏列出的会话逐个 `session/follow`，其中一批返回
`session/follow: no such session "<id>"`（`packages/agent/dsh-session/src/session-controller.host.ts` 的 `follow()`）。
页面仍能用（新建会话、`@` 菜单、模型选择器、权限档位都正常），但历史会话点开会失败。

**已经做过的**

`follow()` 现在对「live store 没有但盘上有」的 id 先 `resumeStored(...)` 再 follow
（reload 之后 live store 是空的，历史会话只在盘上）。这条能覆盖「点开一条历史会话」，
但页面加载时的那一批 follow 仍有失败，说明**客户端拿来 follow 的 id 与 `SessionPersistence.stat` 认识的 id 不一致**
（或 `stat` 的 root 与页面读到的那份列表来源不同）。

**触发条件**

`apps/dsh-custom-next/.dsh-store/sessions/` 里已有会话（现在 39 个）时打开页面。

**销账条件**

Done when：打开一个有历史会话的页面，`agent-browser console` 里 `no such session` 为 0；且点开任意一条历史会话能看到它的消息。

**不修的理由**

需要先确认客户端那批 id 的来源（`ui-session` 的列表 vs 我们的 `session/list`）与 `stat` 的 root 是否同一份，
这属于会话列表/持久化的口径对齐，和「提供方装配」这次迁移是两件事。
