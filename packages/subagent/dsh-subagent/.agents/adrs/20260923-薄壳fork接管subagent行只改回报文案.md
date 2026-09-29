# 薄壳 fork 接管 subagent 行只改回报文案

状态：已采纳

背景：`@deepseek-ai/dsh-subagent` 会在 continuable 子代理的首条任务后追加一段英文回报指引
（`withContinuableReturnGuidance`：父代理 id、用 `send_message` 回报、父代理看不到子代理的转录、可以多次回报、回报
不结束回合）。我们只要**把这段文案换成中文，并按会话选**。上游没有可用的替换面：文案是该包内部常量，无 config、无
settings namespace、无 hook；触发条件由运行时判断（子代理视角下 `send_message` 带内部标记
`Symbol.for('dsh.subagent.adjacentAgentSendMessageTool')`）。

**决定**

沿用 `session/ui-conversation` 已确立的薄壳 fork 形态：保留文件只留有意改过的那份（`continuation-messages.ts` /
`continuation.ts` / `index.ts`），其余 import 指向上游源码、构建内联；装配**按官方行 id 复用**（`id: "subagent"` +
本包 `name`），理由与事实基线见 [ADR 接管官方行按 id 复用](./20260928-接管官方行按id复用而非换id.md)。

中文文案只在「会话挂着本部署那份 preset」时用，其余会话（官方 shipped preset、没挂 preset 的会话、不装 registry 的
部署）走上游英文：名单走 `Config` 的装配面字段 `localizedReturnGuidancePresets`（`.hidden()`，不进设置页），判定在
`continuation.ts` 里读 `ctx.agentPresets` 的 `composedPreset(parent.ctx)`（`src/continuation.ts:210-211`）。

**考虑过的选项**

- **本地 patch（`patches/steps.json` 的 `text` 步骤）**：1 行 diff 最小，但那是改 vendor 树；本仓库对上游的常规姿态是
  「插件包接管」，patch 留给构建约束与上游缺陷。
- **插件层接管派发 / 回报工具**：让触发条件失效（自研不带标记的 `send_message`）再由自研工具描述承担文案。代价是改
  模型面向契约：`tool-subagent-control` 行同时提供 `send_message` 与 `interrupt_agent`，禁用它就得自研两个工具；不改
  契约则要 `agent/created` 时序 + per-agent 变体覆盖，脆弱且升级敏感。为一句文案动契约不值得。
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
