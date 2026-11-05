# 建会话时 workspace 挂载失败不回滚 agent

状态：未销账——`attach` 抛错只 `console.warn` 留痕，会话与 agent 都留在原地
位置：`packages/agent/dsh-conversation/src/server/api-session.provide.ts` 的 `attachWorkspaceOnCreate()`（包在上游 `create` 外面的那层）；`attach` 的失败来源在 `packages/agent/dsh-workspace/src/server/session-workspace.host.ts`

**现象**

`session/create` 的路径是「上游建会话 + 起 agent」→ 本行的包装按 `workspaceId`（没给就按 `cwd`）`attach` 到工作区。`attach` 抛错时：

- 会话已经在 live store 里（`session/list` 会列出它）；
- agent 已经在 `AgentLoop` 里，占着一个槽位；
- 包装只 `console.warn("[session-api] 会话归属工作区失败（会话本身已建好）", error)`，然后照常返回 `sessionId`。

`attach` 的失败来源：上游 `attachSession` 按会话 header 的 cwd 校验归属——workspace 被删、header 校验不过、header 还没落盘都会抛。

**影响**

留下一条「列得出来、但不在任何工作区 `sessionIds` 里」的会话：`session/list` 从 store 派生，而侧栏有没有会话行由 `workspace/sessionIds` 决定（`attach` 之后才变）。界面上表现为选了工作区、输入区仍是「选择工作区」且整条禁用；后续 `session/prompt` / `session/fork` 会看到一条谁也没打算留的会话。

**触发条件**

`attach` 失败：目标 workspace 被删、会话 header 的 cwd 校验不过（`session persistence holds no such session` 一类错误也落在同一条路径上）。

**销账条件**

Done when：`attach` 失败时会话与 agent 都被回收（store 里不留这条会话、`AgentLoop` 里不留这个 agent），且有 spec 覆盖这条失败路径。两条候选路线，选一条——

1. 失败路径显式回滚：从 store 移除会话，并 dispose 已建立的 agent；
2. 把 `attach` 的判断提前到「会话进 store 之前」（`attachSession` 要读 header，顺序由这条语义决定），挂载可能失败就先不建 agent。

**不修的理由**

路线 1 要给 `AgentLoop` 契约加一个 dispose 出口：`packages/agent/dsh-agent-loop/src/contract/agent-loop.contract.ts` 现在只有 `config` / `create` / `createAgent` / `resume`，加一个「只为这条失败路径存在」的方法要连带定它的语义（会话是否一起销毁、是否发事件）。路线 2 要重排「建会话 → 落 header → attach」的既有顺序，而这条顺序正是 `packages/agent/dsh-workspace/src/__tests__/session-workspace.spec.ts` 在断的行为。
