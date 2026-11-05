# preset 写死在行 config，不恢复官方 roster

状态：已采纳——本部署只有一个 preset id，会话没有「换 preset」这条路径。

背景：会话挂着哪一份 agent preset，决定这个 agent 有哪些行（工具、注入面、策略）。上游把这件事做成可换的选择面：registry 持有行清单，roster 在会话空白期换 preset，换完还要重挂一整份行清单。本部署只装一份行清单，模式（[设计 20260928](../designs/20260928-preset平面与模式收口.md)）只回答「这个会话怎么用它们」。

**决定**

`SessionModeDefault.Config.preset`（缺省 `DEFAULT_PRESET = "ptc"`）是本部署唯一的 preset id：`agentPreset` 这个会话投影由本包自己定义（读会话 header 的 `agentPreset`，缺省就是这个值），`SubagentGuidance.Config.preset` 取同一个缺省；`@deepseek-ai/dsh-agent-preset-registry` 不进本包依赖。

**考虑过的选项**

| 选项                                                                | 否掉的理由                                                                                                                                                                          |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 恢复 roster（引 registry，做多 preset 选择面）                      | 本部署没有第二份行清单，roster 只能靠假 registry 演；「换 preset」没有行清单可换，选出来的值也没有装配效果                                                                          |
| 只为 spec 保留 registry 作 devDependency（在用例里构造真 registry） | 契约词汇里已有 `AgentPresets`（`packages/agent/dsh-agent/src/contract/composition-vocabulary.contract.ts` 再导出），spec 从契约取就够；直连上游包的理由消失，多一条依赖就多一处跟随 |
| 把 preset 做成模式字段（每个模式绑一份行清单，切模式即换）          | 切模式要在会话空白期重挂行清单，且两个模式共享一份清单（`presetsOnly` 相同）时不成立；模式的差异全在会话级收口                                                                      |

**后果**

- 改 preset 就是改这一进程装哪份行清单的装配配置，没有会话级选择面；一个部署里两个会话不能挂不同 preset。
- 会话事实照旧可恢复、可继承、可被服务端读到：`agentPreset` 投影从 header 读（fork / 重开带过来），`session-mode/selected` 落的是**模式**而不是 preset。
- `presetsOnly` 只剩声明与反查（`modeForPreset()` 只在唯一时回答），不驱动任何挂载动作。
- 要复活 roster，得先有第二份行清单与一个真实的 registry 行；那是另一条决策，不是把本行改个配置。
