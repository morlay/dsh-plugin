# @morlay/dsh-subagent

上游 `@deepseek-ai/dsh-subagent` 的**薄壳 fork**：host 半只改一件事——continuable 子代理首条任务后面的
**回报指引换成中文**（上游是英文）。服务名（`ctx.subagents`）、providers、其余子路径（`./internal` 等）
与装配位置都不变。设置页那张「子代理」卡片是本包自己的 client 半（见下），不是从上游 fork 来的。

装配由本包的 bundle patch 完成（`cordis.patch.yml`）：官方 `subagent` 行 `disabled: true` + insert
`subagent-fork`（`@morlay/dsh-subagent`），并停掉官方设置卡那两条行（`ui-settings-subagent` 与
`subagent-model-selection-settings`，理由见 [ADR](./.agents/adrs/20260923-设置页自建client半并停掉官方两条入口行.md)）；
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

## 设置页（client 半）

`src/client/` 是**本包自己的代码**（不与上游对照，格式照常走 oxfmt）：Plugins 页里那张「子代理」卡片，
只有限额一段——递归深度（≥ 0）与并行上限（≥ 1），staged 编辑 + 保存/丢弃。

| 面                                              | 内容                                                                          |
| ----------------------------------------------- | ----------------------------------------------------------------------------- |
| `plugins.row.config`（key `@morlay/dsh-subagent#subagent-fork`） | `view: 'summary'` 给一句话说明；`view: 'page'` 给限额表单 |
| settings namespace `subagent-fork`              | 本包 host 行 id 就是 namespace 名；可编辑字段是 `Config` 的两个 volatile 字段 |
| locale namespace `settings.subagent`            | 卡片文案（zh + en，标题「子代理」）                                           |

装配只有两条：包声明了 `dsh.client`（`platform: 'web'`）与 `./client` 入口，client 半就随 app-boot 的
browser roster 一起装（**不需要额外的插行**）；host 行被描述出来之后（`configForms.whileServed(['subagent-fork'])`）
卡片才注册，行不在时卡片一起消失。表单原语来自 fork 的 `@morlay/dsh-client-ui-primitives/client`
（`SettingsForm` / `SettingsValueField` / `SettingsFormModel` / `settingsNumberField`）。

## 文档

- 决策与理由：
  [ADR 薄壳 fork 接管 subagent 行只改回报文案](./.agents/adrs/20260923-薄壳fork接管subagent行只改回报文案.md)、
  [ADR 设置页自建 client 半并停掉官方两条入口行](./.agents/adrs/20260923-设置页自建client半并停掉官方两条入口行.md)
- 已知的债（两处 `continuation-messages` 实例、保留文件跟随方式）：
  [债务 continuation-messages 两份实例与保留文件跟随](./.agents/debts/20260923-continuation-messages两份实例与保留文件跟随.md)
- 测试落点与判据：[本包规范 how-to-verify](./.agents/standards/how-to-verify.md)；薄壳 fork 的通用写法约束见
  [`session/ui-conversation` 的 how-to-write](../../session/ui-conversation/.agents/standards/how-to-write.md)
  （同一形态的包共享那份约束）。

上游同步（patch / 裁剪 / 升级评估）走 `dsh-plugin-upstream-sync` 技能；发布走 CI，本地只构建验证。
