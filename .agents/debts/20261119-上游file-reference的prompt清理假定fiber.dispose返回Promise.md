# 上游 `file-reference-local` 的 prompt 清理假定 `fiber.dispose()` 返回 Promise

状态：未销账——等上游修；本仓不修（只是日志噪音）
位置：`vendor/deepseek-harness/packages/context/file-reference-local/src/index.ts:84`（`disposePrompt`），由它的 `agent/disposed` 监听器触发

**现象**

每释放一个 agent（含队友跑完一轮被回收）就打一条：

```
agent "<id>": agent/disposed listener threw: TypeError: Cannot read properties of undefined (reading 'catch')
```

**根因**

`disposePrompt` 里：

```ts
const fiber = this.promptFibers.get(agent)   // agent.ctx.inject([...], cb) 的返回值
const task = fiber.dispose().catch(...)      // ← dispose() 在这条路径上返回 undefined
```

`fiber` 来自 `agent.ctx.inject(['systemPrompt','tools'], cb)`。在「agent 正在 teardown」这个时点，`Fiber.dispose()` 拿不到可挂的 Promise（返回 `undefined`），于是同步抛 `reading 'catch'`。走的是 `emit` 分发（同步），cordis 的 `emitDisposed` 把它收成一条 warn。

**影响**

只有一条 warn，功能不受影响：teammate 的派发、名单、消息续跑、任务板（create / list / get / claim / complete / reassign / 依赖 / revision CAS）都已验过。副作用是它会**盖掉**同一次释放里真正的失败信息。

**触发条件**

任意 agent 从注册表 detach 时：`agent-loop` 的 teardown（`core/agent-loop/src/index.ts:540` 的 `detachAgent?.()`），子代理回收也走这条。

**销账条件**

Done when：上游 `disposePrompt` 对 `dispose()` 的返回值判空（或 `Fiber.dispose()` 恒返回 Promise），且跑一次 teammate 回收不再出现这条 warn。届时删掉本条，并一起删 `vendor/patches/agent-disposed-stack.patch`。

**为什么本仓不修**

改它要动 vendor 的上游包，而收益只是消一条日志；取证与判断的成本已经由 `agent-disposed-stack.patch` 承担（它把 `emitDisposed` 吞掉的 `error.stack` 打出来，本条就是靠它定位的）。

**取证手段（保留中）**

`vendor/patches/agent-disposed-stack.patch`：在 `core/agent` 的 `emitDisposed` 两处 warn 后追加 `error.stack`。不动控制流；定位到具体监听器后按上面的销账条件一起删。
