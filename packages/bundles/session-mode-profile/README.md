# @morlay/session-mode-profile

会话模式与注入面：**一次装齐 host 平面那几行**——会话模式行（各模式的会话级扩展定义，按会话收口也由它内部持有）、
注入通道、subagent 服务接管行、工具说明（汉化 + 用法分组）。

| 装什么                                     | 数据从哪来                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `session-mode`（模式定义，会话级扩展）     | [`@morlay/dsh-session-mode/rows`](../../profile/dsh-session-mode/src/rows.ts)                                      |
| `subagent` 行（按官方行 id 复用换实现）    | [`@morlay/dsh-subagent/rows`](../../subagent/dsh-subagent/src/rows.ts)                                             |
| `context-assembler`（通道本体）            | [`@morlay/dsh-context-assembler/rows`](../../context/dsh-context-assembler/src/rows.ts)                            |
| `tool-guidance`（汉化 + 用法分组）         | [`@morlay/dsh-tool-guidance/rows`](../../profile/dsh-tool-guidance/src/rows.ts)                                    |
| 行清单（工具 / 命令 / 压缩 / 计划 / 委派） | **不在本包**：会话挂着的 shipped preset（新会话是官方 web-app 的默认 `standard`）                                  |
| 官方 roster 保留（`ui-agent-preset`）      | 官方管"挂哪套行"的选择面；我们的模式 chip 挂 composer 工具行左侧（`conversation.input.left`，list 槽位），两套并存 |

三个模式（`coding` / `chat` / `noop`，真源在 `session-mode` 行的 [`rows` 出口](../../profile/dsh-session-mode/src/rows.ts)）
里，**`noop` 是什么都不加的那一档**：与上游默认一致，想按上游跑或排查扩展干扰时的对照。

**本 bundle 详情页上的配置表单**就是这个 bundle 里那几行的配置：由 `session-mode` 行的 client 半注册进
`plugins.bundle.config`（key = 本 bundle 的包名），形态是"新会话的默认模式 + 每个模式一张可折叠卡片"，支持增删模式
（`noop` 不给删）；读写的是 `session-mode` 那一行的配置命名空间。取舍见
[设计 bundle 配置页](../../profile/dsh-session-mode/.agents/designs/20261002-bundle配置页.md)。

**本包不声明自己的 agent preset**（曾经那份 `preset-mode-switch` 与它的行数据已删除）：行清单归 shipped preset，
模式是叠加在它之上的会话级扩展——chip 不覆盖用户在官方 roster 里选的 preset。代价（计划模式规则段是官方那份英文
契约、`chat` 的两条官方注入面要靠 `agent/pre-step` 上丢、每步仍付一次重算）与判据见
[设计 行清单与注入面的装配](./.agents/designs/20260929-行清单与注入面的装配.md)与
[ADR 不再持有行清单](./.agents/adrs/20260929-不再持有行清单.md)。"先读后改"的豁免不需要自建 preset：它由模式自己的
policy 名单表达（`coding.denyPolicies: [fs/edit-intent]`，见
[设计 按模式的 policy 拦截](../../profile/dsh-session-mode/.agents/designs/20260929-按模式的policy拦截.md)）。
