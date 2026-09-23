# @morlay/dsh-agent-preset

注册自定义模式 `coding` 与 `chat`，各是 `cordis.patch.yml` 里的一行 `@deepseek-ai/dsh-agent-preset`——模式定义里
**只有提示词与能力开关**：

| 行                | 是什么                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------ |
| `persona`         | 提示词（各模式自己的 `persona.ts`），注册 agent 作用域的同名 section，遮蔽部署级那层         |
| `context-scope`   | 开关：`allowTools` 白名单（装配期投影 + 执行层 guard）、`instructions` 与 `runtimeContext`  |
| `fs-intent-relax` | coding 专用的模式取舍行：抢在 host 层「先读后改」策略的 waterfall 前面丢弃结果              |

工具行、注入通道与工具说明**都不在这里**——它们由各自的 bundle 在 profile 平面装一次
（`dsh.profile.bundles` 里的 [`@morlay/dsh-agent-toolkit`](../dsh-agent-toolkit/README.md) 与
[`@morlay/dsh-context-assembler`](../../context/dsh-context-assembler/README.md)）。模式的 `allowTools` 名单从
toolkit 的汉化数据派生（`TOOLKIT_TOOL_NAMES`，工具集与说明同源）。

设计、取舍与装配平面迁移见[设计 预设生成与装配](./.agents/designs/20260917-预设生成与装配.md) 与
[ADR 工具与通道搬到 profile 平面](../../../.agents/adrs/20260923-工具与通道搬到profile平面，preset只做开关.md)；
验证判据见[本包规范](./.agents/standards/how-to-verify.md)。
