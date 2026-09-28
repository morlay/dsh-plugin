# @morlay/dsh-subagent

上游 `@deepseek-ai/dsh-subagent` 的**薄壳 fork**：host 半只改两件事——continuable 子代理首条任务后面的
**回报指引**换成中文（上游是英文，且只在"会话挂着本部署那份 preset"时用，其余会话保持上游那套），以及
**接管官方那一行**（行 id 仍是 `subagent`，见下）。服务名（`ctx.subagents`）、providers、其余子路径
（`./internal` 等）与装配位置都不变。配置页由**官方**那张卡片承担（行 id 没换，`subagent` namespace 照旧）。

装配由本包的装配数据完成（`cordis.patch.yml` / `rows` 出口）：**按官方行 id 复用**——插一条
`{ id: "subagent", name: "@morlay/dsh-subagent" }`，Loader 对同 id 复用同一个 Entry、后者替换入口 options，
所以行 id 与 settings namespace 都还是 `subagent`，官方设置卡（`ui-settings-subagent`）与它的服务行
（`subagent-model-selection-settings`）都不动；顺序前提是本包排在 `@deepseek-ai/dsh-base` 之后。理由与被否的
路线见 [ADR 接管官方行按 id 复用](./.agents/adrs/20260928-接管官方行按id复用而非换id.md)。

回报指引的名单走这一行的 `config.localizedReturnGuidancePresets`（装配给，`.hidden()` 不进设置页）；app 的
`dsh.profile.bundles` 里引用本包。

## 保留文件（3 个）

薄壳 fork 只留**有意改过**的文件，其余上游文件不复制——保留文件里指向它们的 import 走相对路径指向
`vendor/deepseek-harness/packages/subagent/subagent/src/...`，构建时内联进 `dist/index.mjs`
（发布物自包含）。

| 保留文件（`src/`）         | 保留什么                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| `continuation-messages.ts` | 中文文案 + 判定函数 `localizedReturnGuidance`（"这个会话要不要本包那份文案"）              |
| `continuation.ts`          | 接线 + 调用点从"永远是本包文案"改成"按会话选"（读 `ctx.agentPresets` 的 `composedPreset`） |
| `index.ts`                 | 接线 + 装配面配置字段（`localizedReturnGuidancePresets`）+ 两处结构性偏离（见下）          |

静态 import 链决定了复制面：`continuation-messages` ← `continuation` ← `index`，要替换中间那一份就得
连同引用它的两个文件一起接管。原因、被否掉的路线与后果见
[ADR 薄壳 fork 接管 subagent 行只改回报文案](./.agents/adrs/20260923-薄壳fork接管subagent行只改回报文案.md)。

**偏离清单是可执行的**：`src/__tests__/upstream-wiring.spec.ts` 的 `DELTAS` 表逐条登记上面每处偏离（新增
块、改过的行、装配面字段），偏离表里的片段没命中就红——加偏离必须同时登记，否则测试报"偏离表里的片段不在
文件里"。

## 两处结构性偏离

- **`index.ts` 不复述 cordis 合并接口**：上游此处 `declare module '@deepseek-ai/cordis'` 声明
  `Context.subagents` 与 `subagent/*` 事件；本包 `import type {} from '@deepseek-ai/dsh-subagent'`
  引用上游那一份（同形声明复述两遍会在同一个 program 里撞 `TS2717`）。
- **标准装饰器在构建期降级**：`@Remote(...)` 是 TC39 标准装饰器，rolldown/oxc 不降级它（上游管线里这步
  由 tsc 完成），所以 `tsdown.config.ts` 里有一个 esbuild 预转换（只在检测到装饰器语法时生效）。

本包三个保留文件**不做格式化**（`.oxfmtrc.json` 的 `ignorePatterns`）：它们与上游逐行对照是同步纪律的
守护面，格式改了那条守护就失去意义。

## 配置页

**子代理用哪个模型不在这张卡上**：它跟着**父会话的模式**走（`@morlay/dsh-session-mode` 顶层 `models` 里
「模式 → 服务商 / 模型」那两个选择器）。

限额两个字段（`maxDepth` / `maxActiveSubagents`，标了 `.volatile()`）由**官方**那张设置卡承担：接管没换行 id，
`subagent` namespace 照旧，`ui-settings-subagent` 与 `subagent-model-selection-settings` 都不动。

本包**不再有 client 半**（`./client` 出口、字典与字段文案槽都删了）：卡片回来之后它是重复面——两套都注册
`settings.subagent` 字典时，`locale.register` 对同 namespace 同 locale 直接抛错
（`locale namespace "settings.subagent" already has locale "zh"`），官方卡片那一行会加载失败。

`Config` 的 `localizedReturnGuidancePresets` 是**装配面**字段（`.hidden()`）：它不进设置页，由装配那一行给。

## 文档

- 决策与理由：
  [ADR 薄壳 fork 接管 subagent 行只改回报文案](./.agents/adrs/20260923-薄壳fork接管subagent行只改回报文案.md)、
  [ADR 接管官方行按 id 复用](./.agents/adrs/20260928-接管官方行按id复用而非换id.md)、
  （已作废）[ADR 停掉官方设置卡的两条入口行](./.agents/adrs/20260923-停掉官方设置卡的两条入口行.md)
- 已知的债（两处 `continuation-messages` 实例、保留文件跟随方式）：
  [债务 continuation-messages 两份实例与保留文件跟随](./.agents/debts/20260923-continuation-messages两份实例与保留文件跟随.md)
- 测试落点与判据：[本包规范 how-to-verify](./.agents/standards/how-to-verify.md)；薄壳 fork 的通用写法约束见
  [`session/ui-conversation` 的 how-to-write](../../session/ui-conversation/.agents/standards/how-to-write.md)
  （同一形态的包共享那份约束）。

上游同步（patch / 裁剪 / 升级评估）走 `dsh-plugin-upstream-sync` 技能；发布走 CI，本地只构建验证。
