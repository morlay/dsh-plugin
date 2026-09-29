# @morlay/dsh-tool-guidance

本部署的**工具说明运行时**：包根本身把工具描述换成一行中文、剥掉 schema 里的说明性字段，并把用法按组
送达——`base` 组的正文由本行挂 `agent/pre-step` 常驻注入（按**这个会话装配结果里最终可见的工具目录**过滤），
按需的 `flow` / `delegation` / `team` 三组注册进官方 `ctx.skills`（目录与按需加载由官方 `tool-skill` 那一行
提供）；`rows` 出口只发布 **它那一行**（`tool-guidance`，host 平面）。取舍见
[设计-工具说明与用法分组的送达](.agents/designs/20260929-工具说明与用法分组的送达.md)。

功能行清单（工具 / 命令 / 压缩 / 计划模式 / 委派）**不归本包**：它们住在会话挂着的 agent preset 里（官方 shipped
preset 或部署自建的那份）。取舍见
[ADR 不再持有行清单](../../bundles/session-mode-profile/.agents/adrs/20260929-不再持有行清单.md)。

本包**不装配任何行**：包根没有 `cordis.patch.yml`。装行的那一行在
[`@morlay/session-mode-profile`](../../bundles/session-mode-profile/README.md) 的 host 平面。

| 出口     | 是什么                                                                                              |
| -------- | --------------------------------------------------------------------------------------------------- |
| `.`      | 工具说明运行时：短描述汉化、schema 精简、用法分组（`base` 常驻注入 + 其余三组 skill）、丢弃上游说明 |
| `./rows` | 工具说明那一行（`tool-guidance`）：行 id、模块名与可选 config                                       |

## 用法

装配层把 `tool-guidance` 插在 **host 平面**（`toolGuidanceRow()` 给出行 id 与模块名），装的就是本包的包根
（`@morlay/dsh-tool-guidance`）。`rows` 出口只有数据，没有装配动作。

那一行只有一个开关 `config.groups`（部署级，默认开）：关掉它只剩工具预处理（短描述汉化 + schema 精简），
`base` 常驻注入与按需三组一起不发生——它们是一件事的两半。

模式的 `allowTools` 留空即"不设收窄，用 preset 的全部工具"；要收窄就列名单（见
[dsh-session-mode](../dsh-session-mode/README.md)）。

## 边界

| 归这里                                    | 不归这里                                                                                                                                                                                                                                      |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 工具短描述、用法分组正文、`base` 常驻注入 | 提示词（persona）、能力开关、行清单 → [dsh-session-mode](../dsh-session-mode/README.md) 与它挂的 preset                                                                                                                                       |
| 工具投影的预处理（描述 / schema）         | 注入通道本身 → [dsh-context-assembler](../../context/dsh-context-assembler/README.md)                                                                                                                                                         |
| 工具说明那一行（host 平面）               | 部署级配置值（llm route、搜索后端、沙箱规则）→ [mydsh-profile](../../bundles/mydsh-profile/README.md)、[ollama-provider-profile](../../bundles/ollama-provider-profile/README.md)、[sandbox-profile](../../bundles/sandbox-profile/README.md) |

引用的是上游 `@deepseek-ai/dsh-*` 能力包的**工具名与说明**（本包只发布"说明 + 分组"，不发布它们的实现）。
