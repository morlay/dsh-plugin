# 官方 AgentPreset 恢复与会话级扩展（装配形态）

状态：**已实现**（判据在各包：`preset-plane.spec.ts` 的真装配用例与各 bundle 的 `patch.spec.ts`）
范围：本部署怎么用 agent-preset 机制（行清单归 shipped preset），以及我们的扩展落在哪一层（会话级 persona / 工具与
policy 名单 / 收口 / 注入开关 / 默认模型）。
约束：不改上游 `@deepseek-ai/*`（只读）；扩展只走 cordis 插件层与 profile patch。

## 结论摘要

| 议题            | 结论                                                                                                                                                                                                        | 一句话理由                                                                                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| preset 平面     | `agent-preset-registry` + 官方四个 shipped preset 行；本部署**不声明**自己的 preset                                                                                                                         | 行清单与隔离 realm 是官方机制；自己持有一份清单等于替上游维护行 id 与 `config`（[ADR-不再持有行清单](../../packages/bundles/session-mode-profile/.agents/adrs/20260929-不再持有行清单.md)） |
| 选择面          | 挂哪套行归官方 roster（槽位 `conversation.hero.agentPreset` 是单注册的）；我们的模式 chip 在 composer 工具行左侧，两套**并存**                                                                              | 同一个槽位两个 seat 会直接抛错；官方管"挂哪套行"，我们管"这个会话怎么用它们"                                                                                                                |
| 模式            | **模式 = preset 之上的会话级扩展**：persona / 工具与 policy 的名单（`allowTools` · `denyTools` · `allowPolicies` · `denyPolicies`）/ 三个开关（`instructions`、`skills`、`runtimeContext`）/ `defaultModel` | preset 给"这个 agent 有哪些行"，模式只回答"这个会话怎么用它们"                                                                                                                              |
| 行清单          | 归会话挂着的那份 shipped preset（新会话是官方 web-app 的默认 `standard`）；我们的 host 平面只装自己那几行（`session-mode` / `subagent` / `context-assembler` / `tool-guidance`）                            | 一行只属于一个平面：官方 web-app 已把面向模型的行 `disabled` 让给 preset                                                                                                                    |
| 注入面          | 工作区指令 = 官方 `agent-instructions` 行；技能目录与 `skill` 工具 = 官方 `tool-skill` 行；我们的通道只做文本转换                                                                                           | 那两行在 `agent/pre-step` 里自行送达，通道没有可插的地方；抢面等于与上游对赌                                                                                                                |
| 会话级事实      | `session-mode/selected` 事件与 `sessionMode` 投影**保留**                                                                                                                                                   | 模式事实要能恢复、被子代理继承、被服务端读到，不借官方的 `agentPreset` 表达                                                                                                                 |
| 部署默认 preset | 不配 `agent-preset-registry.default`，用官方 web-app 的默认                                                                                                                                                 | registry 的 `default` 就是"选哪个"的配置面（`vendor/deepseek-harness/packages/preset/agent-preset-registry/src/index.ts:54-55,74`）                                                         |

## 事实基线

官方机制（真源在 `vendor/deepseek-harness/`）：

- preset 声明的数据形状只有 `id` / `name?` / `description?` / `order?` / `plugins`（普通 Cordis 行清单，行 id 可省、`disabled` 可为 `!!js`）：`packages/preset/agent-preset/src/index.ts:16-23`、`packages/preset/agent-preset-registry/src/definition.ts:5-11`。没有 persona / capabilities / isolate 这三个字段——persona 是一行 `@deepseek-ai/dsh-persona`，`isolate` 是**行**选项。
- 挂载：Agent setup 时 `mount(agentCtx, id)`，把 agent 的 scope key 绑到 registry 持有的代际 standing key 上；一个 agent 同时只有一个 preset，子 agent 绑父的**确切代际**：`packages/api/session-controller/src/agent.ts:381-397`、`packages/preset/agent-preset-registry/src/index.ts:226-250,273-284`。
- 服务必须处在 `isolate` realm，否则 mount 直接失败：`packages/preset/agent-preset-registry/src/mount.ts:265-267`；cordis preset 的三组键是 `planMode` / `compaction`+`toolResultPruner` / `workflowEngine`：`packages/bundle/web-app/presets/cordis.patch.yml:44-45,65-67,82-83`。
- 会话只**记录身份**（header + 空白期的选择事件 + projection），换 preset 限会话空白期，否则 `agent-preset/locked`：`packages/preset/agent-preset-registry/src/session.ts:1-13,20-30,35-44`、`src/index.ts:318-334`。
- 没有声明写入口：新 preset 与覆盖内置 preset 都是 bundle patch（整段替换 `config.plugins`，不合并后续内置变更）：`packages/preset/agent-preset-registry/README.md:48`、`dsh-plugin-upstream-sync` 技能。
- 平面分工：面向模型的行归 preset 平面，其余留在 host 平面；官方 web-app 自己把 `tool-bash` / `tool-fs` / `tool-fs-search` / `tool-skill` / `skill-filesystem` / `compaction-basic` / `tool-subagent*` 等一整批 host 行标 `disabled: true`，理由写在行上方：`packages/bundle/web-app/cordis.patch.yml:444-530`，架构说明见 `vendor/deepseek-harness/.agents/notes/implemented/architecture/2026-08-10-host-plane-ownership-after-presets.zh.md`。
- 官方 preset 自带的注入行：`standard` / `ptc` / `cordis` 带 `agent-instructions`（工作区指令）与 `tool-skill`（技能目录 + `skill` 工具），`minimal` 不带——它们在 `agent/pre-step` 里自己 append，不经过宿主通道。
- 槽位注册是**单注册**：`single slot "X" already has a registration` 直接抛错：`packages/client/ui-slots/src/index.ts:1203-1233`。官方 seat 占 `conversation.hero.agentPreset`（名单面）：`packages/client/ui-agent-preset/src/client/index.ts:177-183`；我们的模式 chip 放在同 scope 的 **list** 槽位 `conversation.input.left`（composer 工具行左侧——新会话屏也是 blank session 的 composer，头部槽位在那里不存在）：`packages/profile/dsh-session-mode/src/client/index.ts`。

本部署的装配（现在是这样）：

- **行清单归 shipped preset**：本部署不声明任何 agent preset，也不覆盖 registry 的 `default`；host 平面由
  [`@morlay/session-mode-profile`](../../packages/bundles/session-mode-profile/README.md) 一次装齐——`session-mode`
  （模式定义 + 按会话收口）、`subagent`（按官方行 id 复用换实现）、`context-assembler`、
  `tool-guidance`（工具说明汉化 + 用法分组：工具投影在 `system-prompt/assemble` 上改写、`base` 组正文由它自己挂
  `agent/pre-step` 常驻、其余组注册进官方 `ctx.skills` 由官方 `tool-skill` 列目录）。
- **模式是会话级扩展**：`config.modes.<id>` 只声明 persona、工具与 policy 的名单（`allowTools` 留空 = 不设收窄，用
  preset 提供的全部工具；`denyTools` / `allowPolicies` / `denyPolicies` 留空 = 不禁）、`instructions` / `skills` /
  `runtimeContext` 三个开关与可选 `defaultModel`（`skills` 不写就按模式自己的工具名单推导：名单里没有 `skill` 就是
  不要技能目录）；`preset` 字段留在 schema 里但三个模式都不写——
  写了才会在切模式时把 preset 切过去，本部署不覆盖用户在官方 roster 里的选择
  （[ADR-模式不绑定preset](../../packages/profile/dsh-session-mode/.agents/adrs/20260929-模式不绑定preset.md)）。真源在
  [`mode-sources.ts`](../../packages/profile/dsh-session-mode/src/mode-sources.ts)，行 config 由 `rows.ts` 渲染。
- **注入面归官方行**：工作区指令来自会话那份 preset 里的 `agent-instructions` 行、技能目录与 `skill` 工具来自
  `tool-skill` 行；[`@morlay/dsh-context-assembler`](../../packages/context/dsh-context-assembler/README.md) 只剩文本转换
  （重排、降级 section、reminder），不再发布注入能力——上游那两行在通道之外送达，按会话丢它们的是 `session-mode`
  的收口（`instructions` / `skills` 两个开关）。
- **选择面两套并存**：官方 roster（`ui-agent-preset`）管挂哪套行，我们的 chip 与 `GET/POST /session-mode` 管会话级扩展，
  且只在**空白会话**成立。
- **子代理的中文回报指引不限制 preset**：`subagent` 行复用官方 id 换实现，不配
  `localizedReturnGuidancePresets`（配了名单就只在名单里的 preset 上生效）。

## 取舍

- **不覆盖 shipped preset 的 `config.plugins`**：官方明说覆盖是整段替换、不合并后续内置变更，等于把官方四个 preset 的
  清单复制进本仓库，上游每次升级都要人工对齐（`packages/bundle/web-app/presets/cordis.patch.yml:1-3`）。
- **不自己持有一份行清单**（理由与代价的 home 是
  [ADR-不再持有行清单](../../packages/bundles/session-mode-profile/.agents/adrs/20260929-不再持有行清单.md)）：代价照实——
  计划模式的规则段是官方英文（不能覆盖 shipped preset 的行 config）、「先读后改」的豁免只能由模式自己的 policy 名单
  表达（`coding.denyPolicies: [fs/edit-intent]`，写路径上的 CAS 安全网留着）、官方那两条注入面要按会话丢只能在
  `agent/pre-step` 上丢条目（`instructions` / `skills` 两个开关）。
- **不把通道搬进 preset realm**：realm 内的服务 host 侧读不到（`mount.ts:129-166`），而工具说明、会话收口这两个
  consumer 都住在 host 平面；搬进去就要把它们一起搬，收益只是"形态更官方"。
- **不接管官方那两条注入行**（不按官方行 id 复用换实现）：它们每步自己重算、自己 append，我们只在
  `agent/pre-step` 的最外层（`prepend`）丢掉不要的条目——替换实现要整段替上游维护，收益只是文案，理由与代价见
  [设计 抑制官方注入面](../../packages/profile/dsh-session-mode/.agents/designs/20260929-抑制官方注入面.md)。

## 开放问题

- 用户在官方 roster 里换 preset 之后 `defaultModel` 怎么算：它仍是模式的字段（配置事实，会话级），换 preset 时的重算
  时机还没定。
- 模式扩展对哪些 preset 生效：所有 preset 都只叠会话级扩展，行清单里缺的模式要的工具**自动跳过**——官方 `minimal` 上
  `chat` 一件都不剩。要不要为这种缺件的 preset 出提示，等有实际反馈再说。
