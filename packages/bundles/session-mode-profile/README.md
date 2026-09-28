# @morlay/session-mode-profile

会话模式与注入面：**一次装齐五块**——本部署自己的 agent preset 声明、会话模式行（各模式的会话级扩展定义）、
subagent 服务接管行、注入通道与它的收口行、工具说明（汉化 + 用法分组）。

| 装什么                                          | 数据从哪来                                                                                               |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `preset-mode-switch`（本部署的 agent preset）   | [`@morlay/dsh-agent-toolkit/rows`](../../profile/dsh-agent-toolkit/src/rows.ts) 的 `TOOLKIT_PRESET_ROWS` |
| `session-mode`（模式定义 + `preset` 映射）      | [`@morlay/dsh-session-mode/rows`](../../profile/dsh-session-mode/src/rows.ts)                            |
| subagent 行（禁官方行 + 插 `subagent-fork`）    | [`@morlay/dsh-subagent/rows`](../../subagent/dsh-subagent/src/rows.ts)                                   |
| `context-assembler` + `context-assembler-scope` | [`@morlay/dsh-context-assembler/rows`](../../context/dsh-context-assembler/src/rows.ts)                  |
| 官方 roster 保留（不再禁 `ui-agent-preset`）    | 我们的模式入口挂在会话头部工具槽位（list），两套并存                                                     |
| `tool-guidance`（汉化 + 用法分组）              | [`@morlay/dsh-agent-toolkit/rows`](../../profile/dsh-agent-toolkit/src/rows.ts)                          |

行清单只有一份真源：数据住在能力包里，本包只把它们的 `rows` 出口按装配顺序展开（`tsdown.config.ts`）。

**一个 preset，两个模式**：`coding` / `chat` 都挂 `preset-mode-switch`（`config.id` 就是会话里记的身份），
差异全由**会话级收口**表达（persona / `allowTools` / `instructions` / `runtimeContext`）。行清单里
**不放注入面**：`agent-instructions` 与 `tool-skill` 由通道提供，`tool-guidance` 是 host 平面行
（它往通道这个 host 单例注册用法正文，两个平面各一份会互相顶掉）。新会话的默认 preset 在配置层指向它
（[`@morlay/mydsh-profile`](../mydsh-profile/README.md) 的 `agent-preset-registry.default`）。
理由与代价见 [ADR-自己注册preset](./.agents/adrs/20260929-自己注册preset.md)。

**注入面按会话判归谁**：`context-assembler` 这一行装的是通道本体 + `agent-instructions` + `skill-catalog`，
两条面方向相反——

- **工作区指令让位**：官方 `standard` / `ptc` / `cordis` 的 preset 自带 `@deepseek-ai/dsh-agent-instructions`，
  那些会话的工作区指令由 preset 提供；`preset-mode-switch` 的行清单里没有那一行，两个模式的会话都由这一行提供。
- **skill 面由通道提供**：`skill` 工具按会话注册进 agent 自己那一层，遮蔽 preset 的 `@deepseek-ai/dsh-tool-skill`
  那一份（官方 preset 会话如此；我们自己的行清单里没有上游那一行），目录也由我们发布。

模式开关（`instructions: false`）只收得住这一行这一侧；官方 preset 自带的注入在它之外，所以切模式时官方
preset 该换还是要换（`SessionModes.select` 只在目标与当前不同时才换）。理由与上游判据见
[ADR-工作区指令让位skill面由通道抢面](../../context/dsh-context-assembler/.agents/adrs/20260929-工作区指令让位skill面由通道抢面.md)。
