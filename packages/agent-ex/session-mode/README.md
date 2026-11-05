# @morlay/session-mode

会话模式、工具说明分组与提示词通道：**模式是一份数据**（人格 + 工具 / 技能 / policy 名单 + 三个注入开关），
按会话在宿主侧收口；PTC 由**运行时事实**（模型面工具目录里有 `run_code`）触发，不是模式里的一项开关。

preset 平面与模式收口的设计见 [preset 平面与模式收口](./.agents/designs/20260928-preset平面与模式收口.md)。

## 用法

- 宿主半：`provideSessionMode(configure(SessionModeDefault, { default, modes, preset }))`（`@morlay/session-mode/server`）。
  它的默认清单是收口、提示词通道、子代理文案接管与模式服务——子代理那一行
  也在这里装，`configure(SubagentGuidance, { … })` 可覆盖它的 Config；`sessionMode` 的 wire 端点单独装
  （`provideSessionModeEndpoints()`，从包根出）。
- 浏览器半：`provideSessionModeUi()`（`@morlay/session-mode/ui`）——composer 的模式 chip 与右栏模式面板。
- 两端共用形状：`@morlay/session-mode/endpoint`（模式配置、清单、生效态与 `sessionMode` 组契约）。
- 工具分组表从**包根**取（`TOOL_GROUPS` / `SHORT_TOOL_DESCRIPTIONS` / `groupOfTool` / `groupSkillBody` …）：
  工具名 → 一行中文、组归属、常驻与否、d.ts 渲染。没有独立的 `./groups` 子路径。

## 出口

| 出口         | 是什么                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `.`          | 契约（`SessionMode` / `SessionScope` / `ContextAssembler` / `ToolGuidance`）、默认实现、模式源数据、PTC 的纯函数、分组表 |
| `./endpoint` | 两端共用的形状与 `sessionMode` 组契约                                                                                    |
| `./server`   | 宿主半装配 `provideSessionMode`、端点实现、通道装配 `provideContextAssembler`                                            |
| `./ui`       | 浏览器半装配 `provideSessionModeUi`、chip 与右栏面板视图                                                                 |

## preset 平面：写死 `Config.preset`（默认 `"ptc"`），没有 roster

本部署**只装一份 agent preset 行清单**（`ptc` 那份），没有官方 registry 的多 preset 选择面。所以：

- 「本部署那个 preset id」的唯一出处是 `SessionModeDefault.Config.preset`（缺省 `DEFAULT_PRESET = "ptc"`，
  `src/session-mode.service.ts`）。`agentPreset` 投影由本包自写的 `agentPresetProjection(preset)`
  （`src/session-mode.projection.ts`）给出：值取会话 header，没有就是部署那一个。
- **实现零引用** `@deepseek-ai/dsh-agent-preset-registry`：`presetRegistry()` / `composedPresetOf()` /
  `agent-preset/selected` 监听都已不存在。本包不拥有装配清单（换 preset 需要的装配在上层）。
- 本包的依赖里**没有** `@deepseek-ai/dsh-agent-preset-registry`：实现零引用，测试也不再直连上游构造 registry；
  preset 相关的判据在 `src/__tests__/session-mode.spec.ts`。`AgentPresets` 这个词仍由
  `@morlay/dsh-agent` 的契约面再导出，本包不用。
- 切模式**不换 preset**（取舍见源包 ADR `20260929-模式不绑定preset`，本仓未搬这份记录）：
  `allowTools` / `denyTools` 只在当前行清单之上收窄。

## 两套 reminder：谁在生产、谁只用来对账

- **生产通道 = `src/reminder.ts`**：信封带 id 的 `<system-reminder id="…">`，一条 section 一个 id，
  **同 id 文本未变不重发**（幂等键是 `source.id` + `kind: "context-assembler"`）。
  工具说明的**常驻正文**是另一套身份：上游 `kind: "skill-invocation"` + `source.name`，信封**不带 id**。
  两者都是 user 消息，读法必须按来源分开，混着读会互相顶掉。
- **`src/system-remainder.ts` 生产不用**：它是源包 `profile/dsh-session-mode` 那套 `<system-remainder>`
  （不带 id、按正文比较幂等），源包里同样没有生产消费者。保留只为与源包**可对账**——
  `src/__tests__/system-remainder.spec.ts` 那 7 条是上游同步的对账锚。改它必须同步改源包口径；
  **不要**把两套合并或抽成一个抽象（幂等语义不同）。

## 子代理文案

模型可见的两处英文换成中文，**不 fork 上游实现**：回报指引在 `agent/pre-step` 上把已认领消息里那块英文
换成中文，委派范围说明（`subagent:delegation`）在 `system-prompt/assemble` 上换那一条上下文。
中文回报指引默认对任意会话生效；`configure(SubagentGuidance, { localizedReturnGuidancePresets })`
配了名单才收窄成只有名单里的 preset 用中文（名单比对的是上面那个 `Config.preset`）。

实现在 `src/subagent/**`（`return-guidance` / `delegation-context` 两个纯函数文件 + 接管行
`SubagentGuidance`），装配函数是 `provideSubagentGuidance`（`src/subagent.provide.ts`，从包根出）。

为什么只搬这么两处、源包那套薄壳 fork 为什么在这里不成立，见
[设计 子代理接管面](./.agents/designs/20261106-subagent接管面只搬两处文案.md)。

## 设计

- 模式不绑定 preset：行清单由会话挂着的 agent preset 提供，`allowTools` / `denyTools` 只在这之上收窄。
- PTC 的判据是运行时事实：装配里出现 PTC 执行器注册的 `tools:ptc-only` section 时，`tools:sdk` 换成稳定骨架、
  按需组的工具说明不再占 system（随 `describe_tool` 现取）。
- 收口不发布服务：它的输入是模式定义、唯一消费者也是模式。
