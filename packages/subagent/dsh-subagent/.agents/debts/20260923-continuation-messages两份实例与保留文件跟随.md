# continuation-messages 两份实例与保留文件跟随

状态：未销账（`@morlay/dsh-subagent` 是官方 `subagent` 行的薄壳 fork；保留文件与上游逐行对照由测试守护，上游改了
这三个文件就得跟着改）

**现象**

1. **`continuation-messages.ts` 在运行期有两份实例**：本包那份（中文回报指引；结算消息与上游同形）由本包复制的
   `manager.ts` 使用；vendor 那份随上游 `@deepseek-ai/dsh-subagent` 一起加载——providers（`subagent-spawn-in-process`、
   `subagent-fork-in-process`、`subagent-acp`、`subagent-dsh-sdk`）都值导入该包，模块图里就带上了上游的
   `manager.ts` 与它引的那份 `continuation-messages.ts`。上游 0.2.1-alpha.2 之前，vendor 那份的消费者是未复制的
   `continuation-activation.ts`（902 行）；那一版把它并进 `manager.ts`，而 `manager.ts` 已被本包复制。
2. **保留文件跟随靠人读、靠测试兜底**：三个保留文件里，`manager.ts` / `index.ts` 只允许接线不同，
   `continuation-messages.ts` 只允许 `withContinuableReturnGuidance` 内不同——这些由
   `src/__tests__/upstream-wiring.spec.ts` 逐行守护（上游改动会红），但**它不判断语义**：上游改了行为而行级对照仍
   相等时，测试不会提醒。跟随方式：`git -C vendor/deepseek-harness diff` 看这三个文件，把改动搬进保留文件（接线照
   归一规则改写，即指向上游源码的相对路径），跑测试确认偏离集合没变大。0.2.1-alpha.2 把中间那份从 552 行的
   `continuation.ts` 换成 1475 行的 `manager.ts`，跟随负担随之变大。
3. **保留文件不做格式化**：`.oxfmtrc.json` 的 `ignorePatterns` 忽略 `packages/subagent/dsh-subagent/src/*.ts`——
   格式化会引入成千行无关偏离，行级对照失去意义；改这三个文件时手工保持上游的引号与分号风格。

**影响**

- 两份实例的影响面被评估为可接受：两个 `declare module '@deepseek-ai/dsh-llm'` 扩展声明幂等，`MessageSourceMap`
  合并后同形，产物里的 `subagent-settled` 与 `agent-message` 语义一致；区别只在回报指引这一处文案，而它由本包那份
  产出。**代价**：同步上游时容易看漏 vendor 那一份（改文案不必动它，但改**结构**要评估它是否也变）。
- 行级守护不判断语义，所以「上游改了行为、行级对照仍相等」这类漂移只能靠同步流程里人工读一遍上游 diff 才能发现。

**触发条件**

- 动 `continuation-messages.ts` 的**结构**（不只是文案）时，必须先看 vendor 那一份是否也跟着变；
- 每次同步 `vendor/deepseek-harness`（尤其 `packages/subagent/subagent`）之后，走一遍上面的跟随流程并跑
  `upstream-wiring.spec.ts`。

**销账条件**

Done when：本包不再复制 `manager.ts`（上游把文案抽成可配置面，或把结算消息与回报指引拆到本包能单独接管的模块），
两份实例随之消失；行级守护的语义缺口由上游测试或契约替代。

**不修的理由**

不为了消掉两份实例去 fork 上游的 `activation.ts` 或整包复制——那是把同步负担搬进本包；行级对照 + 上游 diff 人工过
一遍，仍是成本更低的组合。`manager.ts` 的复制面已经由 0.2.1-alpha.2 的上游重构推高到 1475 行，但放弃中文回报指引或
改走本地 patch 的代价更高（见 [ADR 薄壳fork接管subagent行只改文案](../adrs/20260923-薄壳fork接管subagent行只改文案.md)）。
