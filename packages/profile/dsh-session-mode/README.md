# @morlay/dsh-session-mode

会话模式：`coding` 与 `chat` 各是**一份数据**——一段提示词（persona）、一组能力开关、一个**角色**
（`role`：谁可以用它）与可选的**默认模型**（`defaultModel`）。本包把它按会话应用到会话自己的作用域上，
并提供页面上的选择面。**模式不是 Cordis 子树**：官方 agent preset 那一整套在装配层被
关掉，禁哪些行归 [`@morlay/dsh-profile`](../dsh-profile/README.md)（真源 `tool/patch.ts` 的 `PATCH_ROWS`），
本包不复述清单。

`cordis.patch.yml` 是这里唯一装配的东西：两行。

| 行                        | 是什么                                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| `session-mode`            | 模式清单与默认值（`config.modes` / `config.default`）+ 按会话应用 persona + 清单与切换的 HTTP 路由 |
| `context-assembler-scope` | [`@morlay/dsh-context-assembler/scope`](../../context/dsh-context-assembler/README.md)：按会话收口 |

工具行、注入通道与压缩都不在这里——它们由各自的 bundle 在 profile 平面装一次（`dsh.profile.bundles` 里的
[`@morlay/dsh-agent-toolkit`](../dsh-agent-toolkit/README.md) 与
[`@morlay/dsh-context-assembler`](../../context/dsh-context-assembler/README.md)）。

## 一个模式是什么

```yaml
- id: session-mode
  name: "@morlay/dsh-session-mode"
  config:
    default: coding
    modes:
      chat:
        name: 对话模式
        description: 只做对话：提问与联网（搜索、抓取）三件工具，不注入系统提示词、工作区指令与技能目录。
        role: [main]
        persona:
          prefix: 你是一个助手。……
        allowTools: [ask_user_question, web_search, web_fetch]
        instructions: false
        runtimeContext: false
```

| 字段                   | 落到哪                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| `name` / `description` | 选择器与头部标签的文案（HTTP 清单里给页面）                                                  |
| `role`                 | 归谁用：`main` 进用户选择器，`subagent` 表示可作为子代理的 mode（候选集）；缺省 `["main"]`   |
| `defaultModel`         | 这个模式的默认模型（`provider` / `model` / `reasoningEffort?`）；不写就跟全局默认            |
| `persona`              | 装配前注册到**该 agent 的 scope**（`deployment:persona-prefix` / `-suffix`，遮蔽部署级那层） |
| `allowTools`           | `context-assembler-scope` 收口：模型目录、`tool:<名字>` 说明、执行层 guard                   |
| `instructions`         | 同上：`false` 表示这个会话不要任何 instruction 类注入（工作区指令、技能目录、用法正文）      |
| `runtimeContext`       | 同上：`false` 表示不要动态快照（文件沙箱策略、审批策略）                                     |

模式名与说明是数据、不做语言翻译（`tool/modes.ts` 里只有中文）——取舍如此，不是漂移。

**自定义就是改这份 config**：profile 的用户 patch 层可以整体改写 `config.modes`，也可以只给某个模式换提示词或
白名单——不需要任何插件行。默认模式（`default`）也在这里：它与模式清单是同一个事实的两半。装配期的判据
（默认模式必须在清单里、每个模式至少给一个工具）由 `modes.ts` 的 `configProblem` 兜住，写错直接拒绝装载。

## 会话与模式

- 新会话用 `config.default`；`agent/created` 时把模式应用到该 agent（persona + 收口），早于它的第一次装配。
- 会话可以**在空白窗口里**换模式：`select` 记一条 session 事件（`session-mode/selected`）并立刻重新应用。
  跑过 turn 之后拒绝——那段历史是在旧模式的工具与提示词下产生的，改了它，日志与实际装配就对不上。
- 当前模式读的是 session 投影 `sessionMode`（`null` 表示没选过）：恢复与 fork 都据此重建，页面也从会话列表
  里直接读到它。
- **子代理继承父的模式**：子代理是新会话，创建时（`agent/created`）取父当前模式并写进子会话日志——继承也是
  一条会话事实，恢复与 fork 照样能重建。父不在场时回落部署默认。继承**不看 `role`**：`subagent` 角色声明的
  是"可被指定"的候选，不是继承白名单。

## 角色与默认模型

- **角色**：`main` = 用户侧可选（选择器与 `select` 只认它）；`subagent` = 可作为子代理 mode 的候选。
  「按角色指派 mode」还没做——子代理现在只有"继承父"与预留的服务接缝
  （`ctx.sessionModes.applyTo(agent, mode)` / `modesFor("subagent")`）。
- **默认模型**：模式的 `defaultModel` 只在会话**尚无模型事实**时接管请求路由（投影 `modelSelection` 没有
  `pending`、`requestHeader()` 还没落）；一旦用户选过模型或会话跑过请求，就不再插手。它是**配置事实**，
  不写会话事件——重启后仍由 config 决定，与用户在设置里做的那条会话级选择（`model/selection`）是两件事。

## 页面上的两个位置

| 槽位                                  | 呈现                                        |
| ------------------------------------- | ------------------------------------------- |
| `conversation.hero.agentPreset`       | 新会话屏幕的顶部占位：chip 点开就是切换列表 |
| `conversation.session.header.actions` | 会话头部的只读模式标签                      |

两块都由本包的 `./client` 出口提供（与 host 半同包、同一次构建）；清单与切换走 HTTP 路由
`GET/POST /session-mode`，当前值走上面那条投影。官方 `@deepseek-ai/dsh-client-ui-agent-preset` 带来的第三个面
（设置页的 roster 面板）不做——模式清单是装配配置，改它不需要页面。

## 文档

- 设计与取舍：[设计 会话模式](./.agents/designs/20260924-会话模式.md)、
  [ADR 模式的角色与默认模型](./.agents/adrs/20260923-模式角色与默认模型.md)、
  [ADR 模式不再是 Cordis 子树](./.agents/adrs/20260924-模式不再是cordis子树.md)
- 验证判据：[本包规范 how-to-verify](./.agents/standards/how-to-verify.md)
- 形态沿革（已作废）：[ADR preset 改用上游声明式行](./.agents/adrs/20260922-preset改用上游声明式行.md)、
  [ADR 通道与注入行按模式 isolate 装配](./.agents/adrs/20260922-通道与注入行按模式isolate装配.md)、
  [设计 预设生成与装配](./.agents/designs/20260917-预设生成与装配.md)
