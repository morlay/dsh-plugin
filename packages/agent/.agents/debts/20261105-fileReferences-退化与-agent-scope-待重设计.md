# `@` 文件候选退化；per-agent 作用域待重设计

状态：未销账

**现象**

1. `provideApiSession()` 里移掉了 `FileReferenceServiceRow`，`sessionReferenceResolver` 与
   `fileReferences` 两个端点因此没有实现（`dsh-session-api` 的两条 spec 红）。
2. `AgentScope` 只有骨架：`compose()` 不实例化任何插件（注释指向 zephyr design 第十节）。

**为什么这么绕**

`file-reference-local` 在**每个 agent** 上 `agent.ctx.inject(['systemPrompt','tools'], …)` 注册
`context:file-reference` 段落，而 `SystemPrompt.section()` 用的是**服务实例自己的 ctx**
（全局那一份）→ 层永远是 global → 第二个 agent 注册就撞
`prompt section "context:file-reference" is already registered`。

撞名让 `create` 直接失败，会话建不出来——页面上的权限切换 / `@` / slash command / 右侧栏 / 统计
全部没法用。所以先把 `FileReferenceServiceRow` 移出装配，换来「会话能建」。

**销账条件**

Done when：`@Injectable({ scope: "agent" })` 在框架里落地（zephyr design 第十节），
`FileReferenceServiceRow` 回到 `provideApiSession()`，且：

- `dsh-session-api` 的 `fileReferences/list` / `sessionReferenceResolver/candidates` 转绿；
- 真机新建第二个会话不再撞 `context:file-reference`；
- 输入区输入 `@` 能弹出文件候选。

**待定的设计问题**（先定再动手）

1. agent scope 是不是一个新的 ctx 层（`agentCtx.isolate(...)`），还是上游 `createScope` 的 `extend` 里补 `isolate`？
2. 这层的生命周期归谁（agent dispose 时整层回收）？
3. `@Injectable({ scope })` 的取值除 `"agent"` 之外还要不要别的（`"session"`？）？
4. cordis 的 `reflect.provide` 用根 reflect 的 ctx 算 isolate key——绕开（自己算 key、自己维护 store 条目）
   还是让上游算对（patch `createScope`，`agentCtx.extend` 时带 isolate）？
