# @morlay/mydsh-profile

> **私有包**：只在本地/本仓库内使用，不对外发布（`private: true`，无 `publishConfig`）。

我的 dsh 个人配置项：**按行 id 覆盖 `config`**（行由官方 base / web-app 提供），并**统一声明四份 agent preset**——
从上游 web-app 的四份 shipped preset 逐行复制，唯一改动是删掉与 Agent Teams 冲突的子代理工具行。

| 配什么                  | 值                                                          |
| ----------------------- | ----------------------------------------------------------- |
| `locale`                | 界面语言 `zh`                                               |
| `ui-settings-general`   | 欢迎提示预置成已确认（与上游常量一致，由测试守护）          |
| `agent-default-model`   | 默认模型（ollama 路由）                                     |
| `ui-chat`               | 对话视图展开                                                |
| `session-log-deepseek`  | 关掉官方 DeepSeek 请求携带的会话日志（`enabled: false`）    |
| `agent-preset-registry` | 部署默认 preset 是 `ptc`（用户级 `selectedDefault` 仍优先） |

## agent preset

| 行 id             | preset     | 用途                            |
| ----------------- | ---------- | ------------------------------- |
| `preset-standard` | `standard` | 通用行清单（工具面最完整）      |
| `preset-ptc`      | `ptc`      | PTC（程序化工具调用）；部署默认 |
| `preset-minimal`  | `minimal`  | 最小行清单                      |
| `preset-cordis`   | `cordis`   | Cordis 自扩展                   |

四份都按行 id **整段替换** `config.plugins`（上游语义如此，不合并后续内置变更）。与上游的唯一差别：删掉
`delegation` 组里的 `tool-subagent-control` / `tool-subagent` / `tool-subagent-fork`——Agent Teams 用同名工具接管
直连委派，两套并存会互相遮蔽；Workflow 的 `workflow-ptc` / `tool-workflow` 保留。取舍与代价见
[ADR preset 行清单归本包](./.agents/adrs/20261030-preset行清单归本包.md)。

**默认 preset 是本包给的 `ptc`**（按行 id 覆盖 `agent-preset-registry` 的 `config.default`，本包排在其它的 bundle
后面，作为最后写者）：新会话挂 PTC（程序化工具调用）。用户在官方 roster 里选过的默认存成 `selectedDefault`，
优先级高于这里的部署默认。会话模式是叠加在它之上的会话级扩展，见
[设计 官方AgentPreset恢复与会话级扩展](../../../.agents/designs/20260928-官方AgentPreset恢复与会话级扩展.md)。

官方 Office 面**不归本包**：那几件里能停的行（上游 0.2.2-rc.2 起是 `office-kit` / `skill-office`）也不停，技能与载荷工具由桌面宿主的代码挂载
（不是 entry 行，profile 层按 id 停不掉，写进来只会拿到 `entry not found`）。整个 Office 面按会话收口在
[`@morlay/dsh-session-mode`](../session-mode-profile/README.md) 的 `coding` 模式名单里（`denySkills` /
`denyTools`）：技能目录不列、`skill` 工具加载与那个载荷查询被判。

装配：`dsh.profile.bundles` 列出本包即生效——它排在其它的后面，作为"最后写者"给默认值；行与值的分工见
[设计 20260928-官方AgentPreset恢复与会话级扩展](../../../.agents/designs/20260928-官方AgentPreset恢复与会话级扩展.md)。

**插件页不挂长文**：`locale/*.json` 的 `meta.detail` 指向空文件 [`docs/detail.md`](./docs/detail.md)，所以 bundle 详情页的"详细介绍"区是空的；本 README 仍是包门面。
