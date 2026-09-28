# 官方 AgentPreset 恢复与会话级扩展（装配形态）

状态：**已实现**（装配层与两个包按本文改完；判据见各包的测试与真装配探针）
范围：本部署怎么用 agent-preset 机制（行清单归 preset 平面，本部署自己注册一份），以及我们的扩展落在哪一层
（会话级 persona / 收口 / 默认模型）。
约束：不改上游 `@deepseek-ai/*`（只读）；扩展只走 cordis 插件层与 profile patch。

## 结论摘要

| 议题            | 结论                                                                                                                                      | 一句话理由                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| preset 平面     | `agent-preset-registry` + 四个 shipped preset 行恢复，外加**本部署自己的那份**（`preset-mode-switch`，两个模式共享）                      | 行清单与隔离 realm 是官方机制；自己声明一份才拿得住 `chat` 的联网三件（官方 `minimal` 没有 `tool-web`）           |
| 选择面          | 会话级选择归官方 roster（槽位 `conversation.hero.agentPreset` 是单注册的）                                                                | 同一个槽位两个 seat 会直接抛错；两套逐会话选择语义也重复                                                          |
| 模式            | **模式 = preset 的会话级扩展定义**：`preset` 声明挂哪一份（可以共享），只声明 persona / `allowTools` 收口 / 注入开关 / `defaultModel`     | preset 给"这个 agent 有哪些行"，我们只回答"这个会话怎么用它们"                                                    |
| 选择面 UI       | 我们的模式 chip、会话头部标签与 `GET/POST /session-mode` 提供选择；官方 `ui-agent-preset` 行停掉                                          | 槽位单注册；官方 seat 还受「代码工作工具」偏好门控，入口等于没有                                                  |
| 会话级事实      | `session-mode/selected` 事件与 `sessionMode` 投影**保留**：选模式即写入，preset 的选择只在映射唯一时反查写入                              | 模式是会话级扩展的事实（恢复、子代理继承、服务端读取都读它），不借官方的 `agentPreset` 来表达我们的语义           |
| 注入通道        | `@morlay/dsh-context-assembler` 保持 **host 全局一份、不隔离**                                                                            | preset realm 挂 `skill-filesystem` / `tool-skill`，通道检测到 `skill` 已注册就不再注册，两者本来就按这个前提写成  |
| 工具行清单      | 归 preset 平面：toolkit 的 `rows` 发布 `TOOLKIT_PRESET_ROWS` 供本部署那份 preset 引用（另有工具名数据），host 平面只留**一行 `guidance`** | host 平面不再重复装 preset 的行（一行只属于一个平面，官方 web-app 已把那些行 `disabled` 让给 preset）             |
| 先读后改        | 恢复官方 `fs-observation-policy`                                                                                                          | 官方要求装 `tool-fs` 的部署同时装它；模式的抵消行随子树一起退出后，它不再有被禁的理由                             |
| 部署默认 preset | `agent-preset-registry` 的 `default` 在 `@morlay/mydsh-profile` 里配，指向 `mode-switch`                                                  | registry 的 `default` / `selectedDefault` 就是"选哪个"的配置面（[preset.ts:12-18]）；新会话因此直接是我们的行清单 |

## 事实基线

官方机制（真源在 `vendor/deepseek-harness/`）：

- preset 声明的数据形状只有 `id` / `name?` / `description?` / `order?` / `plugins`（普通 Cordis 行清单，行 id 可省、`disabled` 可为 `!!js`）：`packages/preset/agent-preset/src/index.ts:16-23`、`packages/preset/agent-preset-registry/src/definition.ts:5-11`。没有 persona / capabilities / isolate 这三个字段——persona 是一行 `@deepseek-ai/dsh-persona`，`isolate` 是**行**选项。
- 挂载：Agent setup 时 `mount(agentCtx, id)`，把 agent 的 scope key 绑到 registry 持有的代际 standing key 上；一个 agent 同时只有一个 preset，子 agent 绑父的**确切代际**：`packages/api/session-controller/src/agent.ts:381-397`、`packages/preset/agent-preset-registry/src/index.ts:226-250,273-284`。
- 服务必须处在 `isolate` realm，否则 mount 直接失败：`packages/preset/agent-preset-registry/src/mount.ts:265-267`；cordis preset 的三组键是 `planMode` / `compaction`+`toolResultPruner` / `workflowEngine`：`packages/bundle/web-app/presets/cordis.patch.yml:44-45,65-67,82-83`。
- 会话只**记录身份**（header + 空白期的选择事件 + projection），换 preset 限会话空白期，否则 `agent-preset/locked`：`packages/preset/agent-preset-registry/src/session.ts:1-13,20-30,35-44`、`src/index.ts:318-334`。
- 没有声明写入口：新 preset 与覆盖内置 preset 都是 bundle patch（整段替换 `config.plugins`，不合并后续内置变更）：`packages/preset/agent-preset-registry/README.md:48`、[note 2026-09-18](../skills/dsh-plugin-upstream-sync/SKILL.md)。
- 平面分工：面向模型的行归 preset 平面，其余留在 host 平面；官方 web-app 自己把 `tool-bash` / `tool-fs` / `tool-fs-search` / `tool-skill` / `skill-filesystem` / `compaction-basic` / `tool-subagent*` 等一整批 host 行标 `disabled: true`，理由写在行上方：`packages/bundle/web-app/cordis.patch.yml:444-530`，架构说明见 `vendor/deepseek-harness/.agents/notes/implemented/architecture/2026-08-10-host-plane-ownership-after-presets.zh.md`。
- 槽位注册是**单注册**：`single slot "X" already has a registration` 直接抛错：`packages/client/ui-slots/src/index.ts:1203-1233`。官方 seat 占 `conversation.hero.agentPreset`（名单面）：`packages/client/ui-agent-preset/src/client/index.ts:177-183`；我们的模式 chip 放在同 scope 的 **list** 槽位 `conversation.input.left`（composer 工具行左侧——新会话屏也是 blank session 的 composer，头部槽位在那里不存在）：`packages/profile/dsh-session-mode/src/client/index.ts`。

本部署的装配（现在是这样）：

- **行清单归我们自己的 preset**：`bundles/session-mode-profile` 声明一行 `@deepseek-ai/dsh-agent-preset`（`config.id: mode-switch`），`plugins` 用 `@morlay/dsh-agent-toolkit` 的 `TOOLKIT_PRESET_ROWS`（功能行 + 压缩 + 计划；**不含** `tool-guidance`——它是 host 平面行）；官方的四个 shipped preset 与 `ui-agent-preset` 都保留可选。见 [ADR-自己注册preset](../../bundles/session-mode-profile/.agents/adrs/20260929-自己注册preset.md)。
- **默认预设**：`bundles/mydsh-profile` 把 `agent-preset-registry.default` 配成 `mode-switch`（纯值层），所以新会话默认就是我们的行清单；两个模式共享它，差异全在会话级（persona / `allowTools` / `instructions` / `runtimeContext`）。
- **注入面在 host 平面**：`@morlay/dsh-context-assembler` 的通道提供工作区指令与 skill 目录、并抢 `skill` 工具面（我们那份 preset 不放上游 `tool-skill`）；用户切到官方 preset 时由让位/抢面兜住：`packages/context/dsh-context-assembler/src/agent-instructions/preset-owner.ts`、`src/skill-catalog/index.ts`。

## 取舍

- **不覆盖 shipped preset 的 `config.plugins`**：官方明说覆盖是整段替换、不合并后续内置变更，等于把官方四个 preset 的清单复制进本仓库，上游每次升级都要人工对齐（`packages/bundle/web-app/presets/cordis.patch.yml:1-3`）。
- **新增我们自己的 preset 声明（已采纳）**：行清单的所有权回到我们这边——一份清单同时喂两个模式；代价是上游行升版要人工对齐 `TOOLKIT_PRESET_ROWS`，计划模式的规则段也得自己维护。理由与代价见 [ADR-自己注册preset](../../bundles/session-mode-profile/.agents/adrs/20260929-自己注册preset.md)。
- **不把通道搬进 preset realm**：realm 内的服务 host 侧读不到（`mount.ts:129-166`），而工具说明、会话收口这两个 consumer 都住在 host 平面；搬进去就要把它们一起搬，收益只是"形态更官方"。
- **不复用官方 preset 的行清单**：`chat` 挂官方 `minimal` 时那份清单没有 `tool-web`，白名单收口后联网三件一件不剩；复用还要在会话开关之外给上游注入让位、为抢 `skill` 面改目录 kind。
- **不保留 toolkit 的 host 平面行清单**：它插的多数行与官方 base 同 id，靠"后者胜"静默接管，且与官方"一行只属于一个平面"的校验对抗（`scripts/verify-cordis-config.ts:121-137`）；那批行现在住进我们自己的 preset。

## 开放问题

- 模式扩展覆盖哪些 preset：本部署只给自建的那一份（两个模式共享）写扩展；官方 shipped preset 被显式选中时按官方原样跑（没有模式扩展）。
- 换 preset 后 `defaultModel` 的算法：它仍是模式的字段（配置事实），按新模式重算的时机等装配跑通再定。
