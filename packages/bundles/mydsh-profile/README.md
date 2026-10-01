# @morlay/mydsh-profile

我的 dsh 个人配置项：**不插行、不停行**——只按行 id 覆盖 `config`（行由官方 base / web-app 提供）。

| 配什么                 | 值                                                       |
| ---------------------- | -------------------------------------------------------- |
| `locale`               | 界面语言 `zh`                                            |
| `ui-settings-general`  | 欢迎提示预置成已确认（与上游常量一致，由测试守护）       |
| `agent-default-model`  | 默认模型（ollama 路由）                                  |
| `ui-chat`              | 对话视图展开                                             |
| `session-log-deepseek` | 关掉官方 DeepSeek 请求携带的会话日志（`enabled: false`） |

官方 Office 面**不归本包**：那几件里能停的行（`office-to-pdf`）也不停，技能与载荷工具由桌面宿主的代码挂载
（不是 entry 行，profile 层按 id 停不掉，写进来只会拿到 `entry not found`）。整个 Office 面按会话收口在
[`@morlay/dsh-session-mode`](../session-mode-profile/README.md) 的 `coding` 模式名单里（`denySkills` /
`denyTools`）：技能目录不列、`skill` 工具加载与那个载荷查询被判。

**不指定 `agent-preset-registry.default`**：新会话挂哪份 agent preset 用官方 web-app 的默认（`standard`），
本部署不自建也不覆盖——会话模式是叠加在它之上的会话级扩展，见
[ADR 不再持有行清单](../session-mode-profile/.agents/adrs/20260929-不再持有行清单.md)。

装配：`dsh.profile.bundles` 列出本包即生效——它排在其它的后面，作为"最后写者"给默认值。
行与值的分工见[设计 20260928-官方AgentPreset恢复与会话级扩展](../../../.agents/designs/20260928-官方AgentPreset恢复与会话级扩展.md)。
