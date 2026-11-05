# host 侧会话 header 由宿主手填

状态：未销账（只剩「装配里没有 agent 行」这一条退化路径）

**现象**

`packages/agent/dsh-session/src/session-controller.host.ts` 的 `establish()` 有两条分支：

1. **装了 agent 行**（`SessionEndpointDefault` 所在装配的常态）：建会话整体交给 `AgentLoop.create`——它自己
   `sessions.prepare` + `persistence.create(session.header)` + `enter` + `announce`，header 由上游组装。
2. **没装 agent 行**（只有会话域的 spec、纯目录场景）：宿主自己拼 `version` / `createdAt` / `isSeeded`
   交给 `SessionPersistence`，再 `prepare` + `enter` + `announce`。上游 `SessionStore.create` 不走这条路：
   它的类文档写明「Persistence is intentionally not implemented here」，`create` 只做内存会话。

**影响**

只有分支 2 会受 header 形状变化影响：上游新增/改名字段时这里不会跟着变，也不会有编译错误——跑到
`readSessionHeader` 的消费方（`workspace.attachSession`）才会看到缺字段。生产装配走分支 1，不受影响。

**触发条件**

上游 `SessionPersistence.create` 开始接受 `meta`（自己填 header），或提供只建 header 的 API 时，必须先还。
动 header 形状之前也必须先还。

**销账条件**

Done when：分支 2 消失——`grep -n "createdAt\|isSeeded" packages/agent/dsh-session/src/session-controller.host.ts`
零命中，或那两条分支合并成同一条（没装 agent 行时也由 `AgentLoop.create` 承担，只把 agent 部分留空）。

**不修的理由**

分支 2 的存在条件是「装了会话域、没装 agent 域」。现在改它只能让那条装配也依赖 `AgentLoop`（多一个
optional 依赖换掉 8 行手写 header），而那条路径没有生产观察者；等它有了第二个消费方再合并更省。
