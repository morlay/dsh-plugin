# @morlay/dsh-subagent

上游 `@deepseek-ai/dsh-subagent` 的**薄壳 fork**：host 半只改一件事——continuable 子代理首条任务后面的
**回报指引换成中文**（上游是英文）。服务名（`ctx.subagents`）、providers、其余子路径（`./internal` 等）
与装配位置都不变。配置页不在本包：限额两个字段在 `Config` 上（与上游逐行一致）标了 `.volatile()`，页面由
`@morlay/dsh-client-ui-schema-form` 按 schema 自动生成；本包自己的 client 半只给这两个字段补中文文案（见下）。

装配由本包的 bundle patch 完成（`cordis.patch.yml`）：官方 `subagent` 行 `disabled: true` + insert
`subagent-fork`（`@morlay/dsh-subagent`），并停掉官方设置卡那两条行（`ui-settings-subagent` 与
`subagent-model-selection-settings`，理由见 [ADR](./.agents/adrs/20260923-停掉官方设置卡的两条入口行.md)）；
app 的 `dsh.profile.bundles` 里引用本包。

## 保留文件（3 个）

薄壳 fork 只留**有意改过**的文件，其余上游文件不复制——保留文件里指向它们的 import 走相对路径指向
`vendor/deepseek-harness/packages/subagent/subagent/src/...`，构建时内联进 `dist/index.mjs`
（发布物自包含）。

| 保留文件（`src/`）         | 保留什么                                                                       |
| -------------------------- | ------------------------------------------------------------------------------ |
| `continuation-messages.ts` | **唯一实质改动**：`withContinuableReturnGuidance` 的中文文案（保留父 id 插值） |
| `continuation.ts`          | 只有一行接线不同：`continuation-messages.ts` 指向本包那一份                    |
| `index.ts`                 | 接线 + 两处结构性偏离（见下）                                                  |

静态 import 链决定了复制面：`continuation-messages` ← `continuation` ← `index`，要替换中间那一份就得
连同引用它的两个文件一起接管。原因、被否掉的路线与后果见
[ADR 薄壳 fork 接管 subagent 行只改回报文案](./.agents/adrs/20260923-薄壳fork接管subagent行只改回报文案.md)。

## 两处结构性偏离

- **`index.ts` 不复述 cordis 合并接口**：上游此处 `declare module '@deepseek-ai/cordis'` 声明
  `Context.subagents` 与 `subagent/*` 事件；本包 `import type {} from '@deepseek-ai/dsh-subagent'`
  引用上游那一份（同形声明复述两遍会在同一个 program 里撞 `TS2717`）。
- **标准装饰器在构建期降级**：`@Remote(...)` 是 TC39 标准装饰器，rolldown/oxc 不降级它（上游管线里这步
  由 tsc 完成），所以 `tsdown.config.ts` 里有一个 esbuild 预转换（只在检测到装饰器语法时生效）。

本包三个保留文件**不做格式化**（`.oxfmtrc.json` 的 `ignorePatterns`）：它们与上游逐行对照是同步纪律的
守护面，格式改了那条守护就失去意义。

## 配置页

**子代理用哪个模型不在这一行**：它跟着**父会话的模式**走（`@morlay/dsh-session-mode` 顶层 `models` 里
「模式 → 服务商 / 模型」那两个选择器）。官方那张「Subagent 模型选择」卡片与它的服务行在本部署被停掉，模型选择统一
收在一处。

页面由通用 schema 表单生成：`Config` 的两个限额字段（`maxDepth` / `maxActiveSubagents`）标了 `.volatile()`，
`@morlay/dsh-client-ui-schema-form` 为这一行（`subagent-fork`）注册配置入口，渲染成数字输入（staged 编辑 +
保存/丢弃，与上游设置页同形）。边界与下限由 schema 的 `min` / `step` 表达，保存时整段校验。

本包 client 半（`./client`）只做一件事：把两个字段的中文文案注册到**提示面**
（`ctx.schemaFormHints.describe('subagent-fork', ['maxDepth'], …)`，行式配置页把它画成注释行）——
**host 的 `Config` 一行都不动**，那是[薄壳 fork 的同步纪律](./.agents/standards/how-to-verify.md)要求的
（`index.ts` 与上游逐行一致）。

## 文档

- 决策与理由：
  [ADR 薄壳 fork 接管 subagent 行只改回报文案](./.agents/adrs/20260923-薄壳fork接管subagent行只改回报文案.md)、
  [ADR 停掉官方设置卡的两条入口行](./.agents/adrs/20260923-停掉官方设置卡的两条入口行.md)
- 已知的债（两处 `continuation-messages` 实例、保留文件跟随方式）：
  [债务 continuation-messages 两份实例与保留文件跟随](./.agents/debts/20260923-continuation-messages两份实例与保留文件跟随.md)
- 测试落点与判据：[本包规范 how-to-verify](./.agents/standards/how-to-verify.md)；薄壳 fork 的通用写法约束见
  [`session/ui-conversation` 的 how-to-write](../../session/ui-conversation/.agents/standards/how-to-write.md)
  （同一形态的包共享那份约束）。

上游同步（patch / 裁剪 / 升级评估）走 `dsh-plugin-upstream-sync` 技能；发布走 CI，本地只构建验证。
