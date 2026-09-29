# @morlay/session-mode-profile

会话模式与注入面：**一次装齐五块**——本部署自己的 agent preset 声明、会话模式行（各模式的会话级扩展定义）、subagent 服务接管行、注入通道与它的收口行、工具说明（汉化 + 用法分组）。

| 装什么                                          | 数据从哪来                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `ui-primitives-fork`（共享 client 行）          | 每个 client bundle 各插一次：同 id 重复插入是幂等的（Loader 复用同一 Entry，后者胜）                               |
| `preset-mode-switch`（本部署的 agent preset）   | [`@morlay/dsh-agent-toolkit/rows`](../../profile/dsh-agent-toolkit/src/rows.ts) 的 `TOOLKIT_PRESET_ROWS`           |
| `session-mode`（模式定义 + `preset` 映射）      | [`@morlay/dsh-session-mode/rows`](../../profile/dsh-session-mode/src/rows.ts)                                      |
| `subagent` 行（按官方行 id 复用换实现）         | [`@morlay/dsh-subagent/rows`](../../subagent/dsh-subagent/src/rows.ts)                                             |
| `context-assembler` + `context-assembler-scope` | [`@morlay/dsh-context-assembler/rows`](../../context/dsh-context-assembler/src/rows.ts)                            |
| `tool-guidance`（汉化 + 用法分组）              | [`@morlay/dsh-agent-toolkit/rows`](../../profile/dsh-agent-toolkit/src/rows.ts)                                    |
| 官方 roster 保留（`ui-agent-preset`）           | 官方管"挂哪套行"的选择面；我们的模式 chip 挂 composer 工具行左侧（`conversation.input.left`，list 槽位），两套并存 |

行清单只有一份真源：数据住在能力包里，本包只把它们的 `rows` 出口按装配顺序展开（`tsdown.config.ts`）。两个模式怎么共享一份 preset、注入面按会话怎么让位 / 抢面、切模式时官方 preset 为什么还要换，见[设计 行清单与注入面的装配](./.agents/designs/20260929-行清单与注入面的装配.md)。
