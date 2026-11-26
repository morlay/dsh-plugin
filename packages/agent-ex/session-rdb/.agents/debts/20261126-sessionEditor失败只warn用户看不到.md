# `session-editor.store.ts` 的失败只 `logger.warn` + 返回 `false`（调用方静默失败）

状态：未销账——**既有问题，不是剥 `RemoteResult` 那次引入的**
位置：`packages/agent-ex/session-rdb/src/ui/session-editor/session-editor.store.ts`（`SessionEditorController.mutate()`）

**现象**

编辑动作（`retry` / `recall` / `fork`）失败时，`mutate()` 只 `logger.warn` 并返回 `false`；调用方（`session-editor.face.ts` 的 `retry` / `recall` / `fork`）拿到 `false` 后**不做任何用户可见的提示**。用户在界面上看到的是「点了没反应」。

**影响**

失败原因（会话不在运行中、没有重放入口、分支冲突…）只有控制台可见。剥包装那一票把错误消息的来源从 `outcome.error?.message` 换成了异常自带的 `message`，**可见行为不变**（两版都只 warn）——所以这条不是那次改动弄坏的，也不是它该修的。

**触发条件**

任何一次失败的编辑动作（真机上最常见的是「会话已结束时点 retry」）。

**销账条件**

Done when：失败在 UI 上可见（toast 或行内错误），且 `session-editor.store.ts` 的 `mutate()` 把错误消息交给提示层而不是只 `logger.warn`；对应 spec 断言「失败后提示出现」而不是只断言返回值 `false`。

**不修的理由**

这属于**产品行为**（要不要弹提示、弹什么文案、是否可重试），不属于「wire 口径对齐」。混进口径那一票会让 diff 里「行为变化」与「口径变化」分不清——下次读 diff 的人无法判断哪一处是刻意的。
