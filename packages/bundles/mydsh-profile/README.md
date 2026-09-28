# @morlay/mydsh-profile

我的 dsh 个人配置项：**只按行 id 覆盖 config**（行由官方 base / web-app 提供），不插行、不禁行。

| 配什么                  | 值                                                             |
| ----------------------- | -------------------------------------------------------------- |
| `locale`                | 界面语言 `zh`                                                  |
| `agent-preset-registry` | 新会话默认挂本部署自己的 preset（`mode-switch`，两个模式共享） |
| `ui-settings-general`   | 欢迎提示预置成已确认（与上游常量一致，由测试守护）             |
| `agent-default-model`   | 默认模型（ollama 路由）                                        |
| `ui-chat`               | 对话视图展开                                                   |

装配：`dsh.profile.bundles` 列出本包即生效——它排在其它的后面，作为"最后写者"给默认值。
行与值的分工见[设计 官方AgentPreset恢复与会话级扩展](../../../.agents/designs/20260928-官方AgentPreset恢复与会话级扩展.md)。
