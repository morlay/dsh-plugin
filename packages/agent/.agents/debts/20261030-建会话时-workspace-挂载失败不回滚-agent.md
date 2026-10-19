# 建会话时 workspace 挂载失败不回滚 agent

状态：未销账（装了 agent 行时，`attach` 抛错留下会话 + 活 agent，两边都不回收）

**现象**

`packages/agent/dsh-session/src/session-controller.host.ts` 的 `createSession()` 在新建路径上是
`establish(id, target.cwd)` 之后才 `await target.attach(id)`：

- 装了 agent 行时 `establish()` 走 `AgentLoop.create`，会话与 agent 已经进了 store 并 `announce`；
- 返回后 `target.attach(id)` 抛错，这条路径既不从 store 移除会话，也不停已经起来的 agent；
- 没装 agent 行的分支在 `establish()` 里自己做 `persistence.create` + `prepare` + `enter` + `announce`，
  `announce` 抛错时有 `release()` 回滚（注释写着「回滚：会话不能留在 store 里（否则会出现「列得出来但不在任何 workspace 里」的幽灵）」），
  但 `attach` 在 `establish()` 返回之后才调用，这条分支的 `release()` 覆盖不到它。

`attach` 的失败来源在 workspace 侧：`packages/agent/dsh-workspace/src/session-workspace.host.ts` 的 `attach` 调上游
`workspace.attachSession(sessionId)`，上游按会话 header 的 cwd 校验它确实属于这个 workspace。workspace 被删、header 校验不过、
header 还没落盘，都会抛。

**影响**

workspace 挂载失败后留下一条「能列出来但不在任何 workspace 里」的会话：`session/list` 从 store 派生（`snapshotForRemote()`），
而页面上是否有会话行由 workspace 的 `sessionIds` 决定（attach 之后才变）。装了 agent 行的装配还多留一个活 agent，
它占着 `AgentLoop` 里的槽位，后续 `session/prompt` / `session/fork` 会看到一条谁也没打算留的会话。

**触发条件**

`workspace.attachSession` 失败：目标 workspace 被删、会话 header 的 cwd 校验不过（`session persistence holds no such session`
一类的错误也落在同一条路径上）。

**销账条件**

Done when：`attach` 失败时回滚已建立的会话与 agent，store 里不留这条会话、`AgentLoop` 里不留这个 agent，并有 spec 覆盖。
两条候选路线，选一条——

1. 失败路径显式回滚：从 store 移除会话，并 dispose 已建立的 agent；
2. 把 `attach` 提前到「会话已进 store」之前，挂载成功才建 agent/会话——可行与否取决于 header 校验需要的 header 是否已经落盘
   （`attachSession` 会读 header），顺序由这条语义决定。

**不修的理由**

第 1 条要给 `AgentLoop` 契约面加一个 dispose 出口：`packages/agent/dsh-agent/src/contract/agent-loop.contract.ts` 现在只有
`config` / `create` / `createAgent` / `resume`，加一个「只为这条失败路径存在」的方法要连带定它的语义（会话是否一起销毁、
是否发 `api-session/*` 事件），比记这条债贵。第 2 条要重排「建会话 → 落 header → attach」的既有顺序，
而这条顺序是 `packages/agent/dsh-workspace/src/__tests__/workspace-session.spec.ts` 正在断的行为，不能顺手改。
