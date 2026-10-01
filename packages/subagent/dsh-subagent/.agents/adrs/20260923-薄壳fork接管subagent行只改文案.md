# 薄壳 fork 接管 subagent 行只改文案

状态：已采纳

背景：`@deepseek-ai/dsh-subagent` 有两处英文文案是模型面向的、上游没有替换面：

1. continuable 子代理的首条任务后追加的**回报指引**（`withContinuableReturnGuidance`：父代理 id、用 `send_message`
   回报、父代理看不到子代理的转录、可以多次回报、回报不结束回合）。我们只要**把这段文案换成中文，并按会话选**。
   上游没有可用的替换面：文案是该包内部常量，无 config、无 settings namespace、无 hook；触发条件由运行时判断
   （子代理视角下 `send_message` 带内部标记 `Symbol.for('dsh.subagent.adjacentAgentSendMessageTool')`）。
2. 子代理自己的**委派范围说明**（运行时上下文 `subagent:delegation`，上游英文原文见 `child-agent.ts` 的
   `SUBAGENT_DELEGATION_CONTEXT`）。它由 `applyChildComposition` 在**子代理自己的 agent 作用域**上注册，两种接管
   手法都不通：同层重复注册同名 context 会抛错（`NamedEntries.insert`），而 fork `child-agent.ts` 不改变运行期
   （注册它的调用方 `continuation-activation.ts` 与 `subagent-in-process-driver` 都在上游未复制的文件里）。

**决定**

沿用本仓库的薄壳 fork 形态（保留有意改过的文件，其余用相对 import 指向上游源码、构建期内联）：保留文件只留
`continuation-messages.ts` / `continuation.ts` / `index.ts` 三份；装配**按官方行 id 复用**（`id: "subagent"` +
本包 `name`），理由与事实基线见 [ADR 接管官方行按 id 复用](./20260928-接管官方行按id复用而非换id.md)。

两处文案各走一条实现面：

- 回报指引：中文文案**默认对任意会话生效**（官方四个 shipped preset、还没绑 preset 的会话、不装 registry 的部署
  都在内）。名单走 `Config` 的装配面字段 `localizedReturnGuidancePresets`（`.hidden()`，不进设置页），**不配就是
  不限**，配了才收窄成「只有名单里的 preset 用中文」，名单外走上游英文。判定在 `continuation.ts` 里读
  `ctx.agentPresets` 的 `composedPreset(parent.ctx)`（`src/continuation.ts:210-211`）。
- 委派范围说明：`subagent:delegation` 在 `system-prompt/assemble` 瀑布里替换文本（`src/delegation-context.ts`，由
  `index.ts` 的构造器挂上）。它改的是**装配结果**而不是注册面，所以在该次装配内生效（第一次装配就是中文），
  continuable 与一次性两条派发路径一起覆盖。

**考虑过的选项**

- **本地 patch（`patches/steps.json` 的 `text` 步骤）**：1 行 diff 最小，但那是改 vendor 树；本仓库对上游的常规姿态是
  「插件包接管」，patch 留给构建约束与上游缺陷。
- **插件层接管派发 / 回报工具**：让触发条件失效（自研不带标记的 `send_message`）再由自研工具描述承担文案。代价是改
  模型面向契约：`tool-subagent-control` 行同时提供 `send_message` 与 `interrupt_agent`，禁用它就得自研两个工具；不改
  契约则要 `agent/created` 时序 + per-agent 变体覆盖，脆弱且升级敏感。为一句文案动契约不值得。
- **对委派范围说明用同名遮蔽 / fork `child-agent.ts`**：都实测过——上游那次注册就在子代理自己的 agent 作用域上
  （`setup(agentCtx, …)` 收到的 `childCtx` 就是 `agent.ctx`），同层注册直接抛错；fork 只改本包那份，运行期读的还是
  vendor 那份（两个调用方都在未复制的文件里）→ 改用装配瀑布替换（见"决定"第二条）。
- **把判定搬进 preset realm**：`subagents` 是**进程单例**（跨会话查询面由 host 的 api-proxy 服务、provider 名全局
  唯一），realm 内的服务 realm 外读不到，搬进去会让 host 那一行饿死（工具读的还是 host 那份）→ 否。
- **给上游提可配置化**：等版本，不可控。

**后果**

- **复制面由静态 import 链决定，不是自由选择**：`continuation-messages.ts`（改文案）被 `continuation.ts` 引用、后者
  被 `index.ts` 引用，所以复制集是这三个文件（约 1375 行）。上游升级时这三个文件要与上游对照跟随，
  [守护测试](../standards/how-to-verify.md) 盯着这件事。
- **偏离面是登记式的**：`src/__tests__/upstream-wiring.spec.ts` 的 `DELTAS` 表逐条登记（新增块、改过的行、装配面
  字段），片段没命中就红——加偏离必须同时登记。
- **两处结构性偏离**（`index.ts` 不复述 cordis 合并接口、构建期降级标准装饰器）各自有理由，见
  [包 README](../../README.md)。
- **`@Remote` 装饰器**：本包走源码入口，vitest 与 tsdown 都必须先降级装饰器（oxc 不做），
  [根债务](../../../../../.agents/debts/20260923-vitest与构建需自行降级标准装饰器.md) 记录了这两处补丁与回退条件。
- **provider 与依赖方不受影响**：服务名、`./internal` 等子路径、`subagent-spawn-in-process` /
  `subagent-fork-in-process` / `tool-subagent-control` 都仍走上游包；只有 `ctx.subagents` 的实例实现来自本包。
- **官方设置卡照常可用**：接管没换行 id，`subagent` 与 `subagent-model-selection` 两个 namespace 都还在，本包因此
  没有 client 半（见[包 README](../../README.md)）。
- **委派范围说明的接管面是装配结果，不是注册面**：它跟着 `system-prompt/assemble` 的每次装配走，上游改了那条 context
  的名字或注册位置时，`src/__tests__/delegation-context.spec.ts` 会红（真子代理的装配里找不到中文那条）。
