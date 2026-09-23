# 薄壳 fork 接管 subagent 行只改回报文案

状态：已采纳

`@deepseek-ai/dsh-subagent` 在 continuable 子代理的首条任务后追加一段英文回报指引
（`withContinuableReturnGuidance`：父代理 id、用 `send_message` 回报、父代理看不到子代理的转录、
可以多次回报、回报不结束回合）。我们只要**把这段文案换成中文**，其余语义一字不动。

上游没有可用的替换面：文案是该包内部常量，无 config、无 settings namespace、无 hook；触发条件由运行时
判断（子代理视角下 `send_message` 带内部标记 `Symbol.for('dsh.subagent.adjacentAgentSendMessageTool')`）。

## 考虑过的选项

- **本地 patch（`patches/steps.json` 的 `text` 步骤）**：1 行 diff 最小，但那是改 vendor 树；本仓库对上游的
  常规姿态是「插件包接管」，patch 留给构建约束与上游缺陷。
- **插件层接管派发/回报工具**：让触发条件失效（自研不带标记的 `send_message`）再由自研工具描述承担文案。
  代价是改模型面向契约：`tool-subagent-control` 行同时提供 `send_message` 与 `interrupt_agent`，禁用它就得
  自研两个工具；不改契约则要 `agent/created` 时序 + per-agent 变体覆盖，脆弱且升级敏感。为一句文案动契约
  不值得。
- **给上游提可配置化**：等版本，不可控。
- **薄壳 fork 接管该行**（本决定）：沿用 `session/ui-conversation` 已确立的形态——保留文件只留有意改过的
  那份，其余 import 指向上游源码、构建内联；装配上禁用官方行、插入本包行。

## 后果

- **复制面由静态 import 链决定，不是自由选择**：`continuation-messages.ts`（改文案）被 `continuation.ts`
  引用、后者被 `index.ts` 引用，所以复制集是这三个文件（约 1375 行，实质改动 1 处）。上游升级时这三个
  文件要与上游对照跟随，[守护测试](../standards/how-to-verify.md) 盯着这件事。
- **两处结构性偏离**（`index.ts` 不复述 cordis 合并接口、构建期降级标准装饰器）各自有理由，见
  [包 README](../../README.md)；偏离之外逐行同源由测试保证。
- **`@Remote` 装饰器**：本包走源码入口，vitest 与 tsdown 都必须先降级装饰器（oxc 不做），
  [根债务](../../../../../.agents/debts/20260923-vitest与构建需自行降级标准装饰器.md) 记录了这两处补丁与
  回退条件。
- **provider 与依赖方不受影响**：服务名、`./internal` 等子路径、`subagent-spawn-in-process` /
  `subagent-fork-in-process` / `tool-subagent-control` 都仍走上游包；只有 `ctx.subagents` 的实例实现来自
  本包。
