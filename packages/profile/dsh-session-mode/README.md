# @morlay/dsh-session-mode

**模式 = agent preset 的会话级扩展**：每个模式声明它挂在哪份 preset 上（`preset`，行清单由那份 preset 提供），
再给这个会话加四样东西——一段 persona、一组工具白名单（收口）、instruction / 动态快照开关、可选默认模型。
本部署的 preset 是**我们自己注册的那一份**（`mode-switch`，见
[`@morlay/session-mode-profile`](../../../bundles/session-mode-profile/README.md) 与
[ADR-自己注册preset](../../../bundles/session-mode-profile/.agents/adrs/20260929-自己注册preset.md)），
两个模式共享它——**差异全由会话级收口表达**。选择面由我们提供（新对话顶部的模式 chip、会话头部标签与
`GET/POST /session-mode`）；模式的选择落成**会话事实**（`session-mode/selected` 事件 + `sessionMode` 投影）。
**模式不是 Cordis 子树**。

本包不装配任何行：行 config 由 `src/rows.ts` 渲染，装配入口在
[`@morlay/session-mode-profile`](../../../bundles/session-mode-profile/README.md)（那里插两行）。

| 行                        | 是什么                                                                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `session-mode`            | 各模式的扩展定义（`config.modes.<id>.preset` + persona / `allowTools` / 开关 / `defaultModel`）与默认模式，按会话应用 + preset→模式反查 |
| `context-assembler-scope` | [`@morlay/dsh-context-assembler/scope`](../../context/dsh-context-assembler/README.md)：按会话收口                                      |

工具行、注入通道与压缩都不在这里：行清单由 preset 的 `config.plugins` 提供（本部署那份由
[`@morlay/session-mode-profile`](../../../bundles/session-mode-profile/README.md) 声明，官方四个 shipped preset
照旧可选），注入通道与工具说明由各自的 bundle 在 host 平面装一次。

## 一个模式是什么

```yaml
- id: session-mode
  name: "@morlay/dsh-session-mode"
  config:
    default: coding
    modes:
      chat:
        # 挂哪份 preset：行清单由它的 config.plugins 提供（本部署这份两个模式共享）。
        preset: mode-switch
        name: 对话模式
        description: 只做对话：提问与联网（搜索、抓取）三件工具，不注入系统提示词、工作区指令与技能目录。
        role: [main]
        persona:
          prefix: 你是一个助手。……
        allowTools: [ask_user_question, web_search, web_fetch]
        instructions: false
        runtimeContext: false
        # 这个模式的默认模型（可选；省略就跟全局 agent-default-model）：
        defaultModel: { provider: ollama, model: deepseek-v4.1-flash, reasoningEffort: high }
```

| 字段                   | 落到哪                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `preset`               | 挂哪份 agent preset（官方或本部署自建的 `id`）：**可以共享**（本部署两个模式共享同一份，差异由会话级收口表达）；空串表示不挂 |
| `name` / `description` | 模式的事实文案（选择面上显示的是官方 roster 的文案）                                                                         |
| `role`                 | 归谁用：`main`（用户选择器）/ `subagent`（可作子代理 mode 的候选）；缺省 `["main"]`                                          |
| `persona`              | 装配前注册到**该 agent 的 scope**（`deployment:persona-prefix` / `-suffix`，遮蔽部署级那层）                                 |
| `allowTools`           | `context-assembler-scope` 收口：模型目录、`tool:<名字>` 说明、执行层 guard、常驻用法正文；**preset 没有的工具自动跳过**      |
| `instructions`         | 同上：`false` 表示这个会话不要任何 instruction 类注入（工作区指令、技能目录、用法正文）                                      |
| `runtimeContext`       | 同上：`false` 表示不要动态快照（文件沙箱策略、审批策略）                                                                     |
| `defaultModel`         | 这个模式的默认模型（可选）：会话还没有模型事实时接管请求路由，不写会话事件                                                   |

顶层还有 `default`（不在模式里）：它是新会话的起始模式；各模式的默认模型在模式自己的 `defaultModel` 里
（`provider` / `model` / `reasoningEffort?`，不写就跟全局 `agent-default-model`）。这些字段都是 config 的
**volatile** 字段，`@morlay/dsh-client-ui-primitives` 为这一行（`session-mode`）生成的行配置页编辑的就是它们。

两类字段的生效方式不同：

| 字段                | 改了之后                                                                                                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `default` / `modes` | 等 Loader 重挂这一行（settings 写完会重装被改的行）；**已运行会话不自动换定义**，重挂后新建的会话或重新应用模式的会话才用新定义（各模式的 `defaultModel` 在 `modes` 里，同一条） |

模式名与说明是数据、不做语言翻译（`src/mode-sources.ts` 里只有中文）——取舍如此，不是漂移。

默认模型为什么能住在模式里：`modes` 整段 volatile，整棵子树都在设置面的投影里，`defaultModel` 作为它下面的普通
字段跟着上页面（自己不必、也不许再标一层 volatile）。判据见
[ADR 默认模型住在模式定义里](./.agents/adrs/20260925-默认模型住在模式定义里.md)。

**自定义就是改这份 config**：profile 的用户 patch 层可以整体改写 `config.modes`，也可以只给某个模式换提示词、
白名单或它挂的 preset——不需要任何插件行。装配期的判据（默认模式必须在清单里、每个模式至少给一个工具、每个
模式的 `defaultModel` 要给全）由 `modes.ts` 的 `configProblem` 兜住，写错直接拒绝装载；`preset` 只要求"非空即
声明了挂载"，它是否存在由 preset 注册表自己回答。

## 会话与模式

- 新会话用 `config.default`；`agent/created` 时把模式应用到该 agent（persona + 收口），早于它的第一次装配。
- **选模式就换 preset**（`select`）：目标 preset 与当前挂着的不同时，先把它换掉（行清单与模式一起换），再写一条
  `session-mode/selected` 并立刻按新模式重新应用；**相同时不换**——本部署两个模式共享同一份 preset，切 chip 因此
  不再重挂行清单。官方 preset 的选择（空白窗口里直接选一个 shipped preset）在这条路上只于**映射唯一**时才反查
  到模式，其余时候模式由会话事实决定。换 preset 只在**空白窗口**成立——跑过 turn 的那段历史是在旧工具集与提示词
  下产生的，换了 preset，日志与实际装配就对不上。取舍见
  [ADR 选模式就换 preset](./.agents/adrs/20260928-选模式就换preset.md)。
- 当前模式读的是 session 投影 `sessionMode`：恢复与 fork 都据此重建（官方的 `agentPreset` 说的是"挂了哪套行"，
  两者不是同一个事实）。
- **子代理继承父的模式**：子代理是新会话，创建时（`agent/created`）取父当前模式并写进子会话日志——继承也是
  一条会话事实，恢复与 fork 照样能重建。父不在场时回落部署默认。继承**不看 `role`**：`subagent` 角色声明的
  是"可被指定"的候选，不是继承白名单。

## 角色与默认模型

- **角色**：`main` = 用户侧可选（官方 roster 的清单按它列）；`subagent` = 可作为子代理 mode 的候选。
  「按角色指派 mode」还没做——子代理现在只有"继承父"与预留的服务接缝
  （`ctx.sessionModes.applyTo(agent, mode)` / `modesFor("subagent")`）。
- **默认模型**：`config.modes[<模式 id>].defaultModel` 只在会话**尚无模型事实**时接管请求路由（投影
  `modelSelection` 没有 `pending`、`requestHeader()` 还没落）；一旦用户选过模型或会话跑过请求，就不再插手。
  它是**配置事实**，不写会话事件——重启后仍由 config 决定，与用户在设置里做的那条会话级选择
  （`model/selection`）是两件事。读的是构造时那份模式清单快照：设置页保存会让这一行重挂，新定义随重挂生效。

## 页面上的选择面

选择面是**本包的 client 半**，挂在会话头部工具区（`conversation.session.header.utilities`，list + session scope）：
一个模式 chip（点开就是清单）与一个只读标签，清单与切换走 HTTP 路由 `GET/POST /session-mode`。

官方 `ui-agent-preset` 那套**保留**（它的 roster 座位在 `conversation.hero.agentPreset`，是单注册槽位）——两套入口
并存：官方管"挂哪套行"的选择面，我们管"会话级扩展"的选择面。`modeForPreset` 只在 preset → 模式的映射**唯一**
时回答（本部署两个模式共享一份 preset，所以它对本部署的 preset 返回 `undefined`：模式由会话事实决定，preset
选了什么不改变这个会话是哪个模式）。

## 文档

- 设计与取舍：[设计 会话模式](./.agents/designs/20260924-会话模式.md)、
  [ADR 模式是 preset 的会话级扩展](./.agents/adrs/20260928-模式是preset的会话级扩展.md)、
  [ADR 默认模型住在模式定义里](./.agents/adrs/20260925-默认模型住在模式定义里.md)、
  [ADR 模式的角色与默认模型](./.agents/adrs/20260923-模式角色与默认模型.md)
- 验证判据：[本包规范 how-to-verify](./.agents/standards/how-to-verify.md)
- 形态沿革（已作废）：[ADR preset 改用上游声明式行](./.agents/adrs/20260922-preset改用上游声明式行.md)、
  [ADR 通道与注入行按模式isolate装配](./.agents/adrs/20260922-通道与注入行按模式isolate装配.md)、
  [设计 预设生成与装配](./.agents/designs/20260917-预设生成与装配.md)
