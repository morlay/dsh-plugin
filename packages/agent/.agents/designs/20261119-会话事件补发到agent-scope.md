# 会话事件补发到 agent scope（`AgentSessionEvents`）

**状态**：已落地。**owner**：`@morlay/dsh-agent-loop`（`AgentSessionEvents`）。

## 问题

每个请求都往会话里追加一整条同样的 `<system-reminder>` 快照（会话身份、工作目录、`AGENTS.md`、技能目录、
沙箱 policy、审批策略都在里面）。几轮之后历史里堆满重复的同一段文本：白烧 token，也让模型分不清哪一份是当前的。

## 根因

1. 上游 `RuntimeContextProjection`（`vendor/deepseek-harness/packages/core/agent-loop/src/runtime-context.ts:145-154`）
   把 `ctx.on('session/event', …)` 挂在 **agent scope** 上（`agent.ts:149` 的 `this.ctx = this.scope.ctx`）。
2. `session.append` 经 `entry.emitCtx` 派发（`core/session/src/index.ts:915`），而 `emitCtx` 是**会话存储实例的
   ctx**（同文件 `:1337`）——本仓的 `provideSession()` 是根上的一行。
3. cordis 的事件**只向上流**：`scopeTarget` 的 filter 只放行「tag 是 dispatch key 或其祖先」的监听器
   （`core/scope/src/index.ts:158-180`）。根上 emit 的事件到不了子 scope 的监听器。
4. 于是 `retained` 永远是 `undefined`，`project()` 的「与上次相同就不发」永远不成立——每个请求一条新快照。

实测：同一会话里 `session/event` 在 agent scope 收到 **0** 次、根收到 **21** 次。

## 决定

在根上收 `session/event`，再**定向**派发到该会话所属 agent 的 scope：

```
根 ctx ──(on session/event)──> AgentSessionEvents ──(dispatch + 只放行该 scope 的 carrier)──> agent.ctx
```

- **为什么定向而不是 `agent.ctx.emit`**：`ctx.emit` 会触发该 ctx 及其**祖先**上的监听器，直接在 agent scope 上
  emit 会让根上的监听器（持久化、投影缓存）再收一次——那是双写。这里用上游 `scopeTarget` 的同一个过滤符号
  （`Symbol(cordis.filter)`）构造 carrier，只放行「`scopeOf(hookCtx) === 本 agent 的 scope key`」的监听器。
- **为什么不用 `@deepseek-ai/cordis`**：本仓没有对它的运行期依赖（`zephyr` 只是 peer，且只有 type import）。
  过滤符号从上游自己构造的 carrier 上取一次（`scopeTarget({}, undefined)` 的产物），取不到就整条不装——
  宁可保留上游行为，也不双触发。
- **`dispatch` 只解析不调用**：拿到的监听器由调用方逐条调用（上游 `collectSessionCallbacks` 同一手法）。

## 前提（写在这里，因为修法依赖它）

**会话存储是根上的一行**。若哪天它变成 agent-scoped（`sessions` 服务按 scope 提供），上游自己就能收到事件，
这条补发会变成双触发——那时应当删掉 `AgentSessionEvents`，并按下面的判据验。

## 判据

`packages/agent-ex/session-mode/src/__tests__/runtime-context-dedup.spec.ts` 三条：

1. 没变就不重发（每步请求里只有一条、日志里只落一条；第二份快照的引导语变化不算内容变化）；
2. **补发不双触发**：根上注册的监听器收到的事件数 == 本轮真实 append 的事件数；
3. 内容变了要发新的一条（不把变化吃掉）。

## 装配落点

- 真装配：`provideAgentLoop()` 的清单里带 `AgentSessionEvents`（`apps/zephyr-custom` 的 `provideAgentLoop(without(ToolExecutorNative))` 因此也带上）。
- 测试装配：`loopTestProviders()` 的 `loopRow` 也带它——少了它，测试里的注入会每步重发，判据就成了「测一个不存在的装配」。
- 双断言判据：这个文件要 cordis Context 的 `events` / `effect`（本仓的 `Context` 面没有），所以它在
  `devpackages/devkit/src/audit/rules.ts` 的 `BRIDGES` 白名单里登记了一条「另一头是 cordis Context」。

## 代价

每个会话事件多一次 `dispatch` + 一次 map 查找（每步几条，可忽略）。会话对象到 agent 的映射按 `WeakMap` 存，
agent scope 卸载时摘掉。
