# @morlay/mydsh-profile

我的 dsh 个人配置项：**只按行 id 覆盖 config**（行由官方 base / web-app 提供），不插行、不禁行。

| 配什么                | 值                                                 |
| --------------------- | -------------------------------------------------- |
| `locale`              | 界面语言 `zh`                                      |
| `ui-settings-general` | 欢迎提示预置成已确认（与上游常量一致，由测试守护） |
| `agent-default-model` | 默认模型（ollama 路由）                            |
| `ui-chat`             | 对话视图展开                                       |

**不指定 `agent-preset-registry.default`**：新会话挂哪份 agent preset 用官方 web-app 的默认（`standard`），
本部署不自建也不覆盖——会话模式是叠加在它之上的会话级扩展，见
[ADR 不再持有行清单](../session-mode-profile/.agents/adrs/20260929-不再持有行清单.md)。

装配：`dsh.profile.bundles` 列出本包即生效——它排在其它的后面，作为"最后写者"给默认值。
行与值的分工见[设计 20260928-官方AgentPreset恢复与会话级扩展](../../../.agents/designs/20260928-官方AgentPreset恢复与会话级扩展.md)。
