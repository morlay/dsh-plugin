# reload 后恢复的空白会话没有 agent

状态：触发中（服务端重启后第一次发消息会撞 `session "<id>" already exists`）

**现象**

`packages/agent/dsh-session/src/session-controller.host.ts` 的 `createSession()` 有一个幂等分支：请求带
`sessionId`、live store 里没有、但盘上有（浏览器 reload 后 `ui-workspace` 的 `restoreBlank` 每次都这么调）时，
它把会话 `prepare` + `enter` 进 live store 并 `announce`，**不起 agent**。

而 `session/prompt` 的解析路径是：`ctx.agents.get(id)` 为空 → `ApiSessionAgentController.resume` →
`AgentLoop.resumeWith` → `sessions.prepare(id, …)`，`prepare` 对已在 store 里的 id 直接抛错，于是
`resume failed for session "<id>": Error: session "<id>" already exists`。

**影响**

服务端重启（改代码、换配置、`just custom web` 重起）后，UI 恢复的那条空白会话第一次发消息必然失败一次；
新建的会话（走 `AgentLoop.create`）不受影响。

**触发条件**

同一条会话在「盘上有、live 无」的状态下被 `session/create` 恢复过，随后被 `session/prompt` 使用。

**销账条件**

Done when：该分支恢复出来的会话能发消息。两条候选路线，选一条——

1. 恢复时也起 agent（`AgentLoop.resume`，需要把行 ctx 当 `ownerCtx` 传）；
2. `session/list` 改为从 `SessionPersistence` 派生目录（不再需要把无 agent 的会话塞进 live store），
   恢复分支只读 header、不 `enter`。

**不修的理由**

两条路线都要动「live store 是唯一真相」这条现有前提（`session/list`、`session/follow`、`SessionStore` 的
消费面全部从 `store` 读），属于会话域的结构调整；本轮只把「新建会话 → 发消息」这条主链路打通，
不让一次改动同时改数据源与建会话语义。
