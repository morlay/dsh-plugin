# @morlay/dsh-agent-toolkit

本部署的**工具数据与工具说明运行时**：`rows` 出口发布功能行清单与工具名（preset 平面那一套的唯一真源），
`guidance` 出口把工具描述换成一行中文、剥掉 schema 里的说明性字段、把用法按组交给注入通道；另有 `agent-team`
（Agent Teams 那一族的行数据）与 `relax-intent`（策略行）两个可选出口。

本包**不装配任何行**：包根没有 `cordis.patch.yml`，`exports` 里只有数据与运行时出口。行由
[`@morlay/session-mode-profile`](../../bundles/session-mode-profile/README.md) 装——preset 平面的
`preset-mode-switch` 引用 `TOOLKIT_PRESET_ROWS`，host 平面只装 [`tool-guidance`](./src/rows.ts) 那一行。

| 出口             | 是什么                                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `./rows`         | 功能行清单与工具名：shell、文件、任务、skill 发现、goal、压缩、计划模式、委派与工作流、问答、todo、联网；`TOOLKIT_PRESET_ROWS` 是 preset 平面那一套   |
| `./guidance`     | 工具说明运行时：短描述汉化、schema 精简、用法分组（组 skill）、丢弃上游说明                                                                           |
| `./agent-team`   | Agent Teams 那一族的行（默认关闭）。本部署的 preset 不放它：要用团队的人加上游 `@deepseek-ai/dsh-experimental-agent-team-profile`（那份自带整套换法） |
| `./relax-intent` | 策略行 `fs-intent-relax`：挂本 preset 的会话不吃上游「先读后改」（`TOOLKIT_POLICY_ROWS` 引用它）                                                      |

## 用法

preset 的 `config.plugins` 直接引用本包的 `TOOLKIT_PRESET_ROWS`（装配入口就是这么声明的，见
[`session-mode-profile` 的 patch 真源](../../bundles/session-mode-profile/tsdown.config.ts)）；模式的 `allowTools`
白名单从 `TOOLKIT_TOOL_NAMES` 派生——工具名与汉化数据同源，preset 里没有的工具自动跳过。数据出口没有装配动作。

## 边界

| 归这里                               | 不归这里                                                                                                                                                                                                                                      |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 工具行清单、工具短描述、用法分组正文 | 提示词（persona）与能力开关 → [dsh-session-mode](../dsh-session-mode/README.md)                                                                                                                                                               |
| 工具投影的预处理（描述 / schema）    | 注入通道本身 → [dsh-context-assembler](../../context/dsh-context-assembler/README.md)                                                                                                                                                         |
| Agent Teams 那套可选行               | 部署级配置值（llm route、搜索后端、沙箱规则）→ [mydsh-profile](../../bundles/mydsh-profile/README.md)、[ollama-provider-profile](../../bundles/ollama-provider-profile/README.md)、[sandbox-profile](../../bundles/sandbox-profile/README.md) |

引用的都是上游 `@deepseek-ai/dsh-*` 能力包（本包只发布"清单 + 说明 + 行 id"，不发布它们的实现）。
