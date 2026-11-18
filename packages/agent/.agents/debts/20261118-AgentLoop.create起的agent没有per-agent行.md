# `AgentLoop.create` 起的 agent 没有 per-agent 行

状态：未销账——本部署的生产代码不调这条路径，所以眼下没有可见后果。
位置：`packages/agent/dsh-agent-loop/src/agent-loop.service.ts`（覆写的落点）；上游 `core/agent-loop/src/index.ts` 的 `create`（内部 `initializeAgent(this.ctx, {...})` 不带 `setup`）；`test-support/agent-loop-testkit/src/index.ts`（唯一的调用方）。

**现象**

per-agent 行的装配点在 `CreateAgentOptions.setup`（上游 `AgentSetup(agentCtx, agent)`），而 `AgentLoopService.create(id, options, meta)` 这条路没有 `setup` 传参：它自己 `initializeAgent(this.ctx, { session, stored, agentOptions, source: 'startup' })`。`AgentRegistry.create(options)` 走的是另一条（`createAgent(ownerCtx, options)`），带 `setup`。

判据：`grep -rn 'AgentLoopService.create(\|loop.create(\|agentLoop.create(' packages apps --include='*.ts'` 在生产代码零命中；上游内部只有 `test-support/agent-loop-testkit` 的 `create: async (id, options, meta) => ctx.agentLoop.create(id, options, meta)` 一处。

**影响**

用 testkit 起的 agent 不带 per-agent 行——工具策略、工作目录、skill、job、ptc、会话端点、`fileReferences` 这些按 agent 分层的条目一个都不会有。撞上时的样子是「这个 agent 少一条 section / 少一个工具」，失败点离装配点很远。

另一面：testkit 与真会话路径的装配面因此**不同形**，用 testkit 写的 spec 测不到 per-agent 能力，也不会因为漏装而红。

**触发条件**

任一条成立就必须先还：本部署出现启动期配置化 agent（launcher 直接调 `create`）；或某个 spec 要用 testkit 验证 per-agent 能力。

**销账条件**

Done when：`create` 起的 agent 也带完整 per-agent 行（覆写 `create` 改调 `createAgent`，或上游 `create` 支持 `setup`），且一条 spec 断言「testkit 起的 agent 与 `createAgent` 起的 agent 装配出的服务名集合相同」。

**不修的理由**

现在改要重写上游 `create` 的整段初始化（会话准备、写句柄、回滚、发布），而本部署没有第二个调用方——收益为零、风险全在上游流程上。等出现真调用方再动。
