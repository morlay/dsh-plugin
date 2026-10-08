# 会话模式

本层是 `packages/profile/dsh-session-mode/`：模式（会话级扩展）与**按会话收口**。门面与用法见
[README](../README.md)，形态与应用时机见[设计 会话模式](./designs/20260924-会话模式.md)，收口与三条官方注入面的抑制见
[设计 抑制官方注入面](./designs/20260929-抑制官方注入面.md)，policy 名单见[设计 按模式的policy拦截](./designs/20260929-按模式的policy拦截.md)。
注入形态与信封（规则块 / 内容块、id、覆盖）是注入通道那边的词
（[注入通道的术语表](../../../context/dsh-context-assembler/.agents/CONTEXT.md)）；工具说明的词在
[`@morlay/dsh-tool-guidance` 的术语表](../../dsh-tool-guidance/.agents/CONTEXT.md)。

## 术语

**模式**：
`session-mode` 行的 `config.modes` 里的一份定义：persona + 工具名单 + policy 名单 + 三个开关 + 可选的默认模型。
它是**会话级扩展**，不是 Cordis 子树、也不持有行清单（那归会话挂着的 shipped preset）。当前模式是一条会话事实
（事件 `session-mode/selected` + 投影 `sessionMode`）。
_避免使用_：profile（那是装配层的一份 bundle）

**收口**：
本包按会话把模式落到这个 agent 上的那一件事（`src/scope.ts` 的 `SessionScope`，模式行内部持有、**不发布服务**）：
工具面合成一份（最终可用 = `(allowTools 留空 ? 全部 : allowTools) − denyTools`，同名时黑名单优先），装配投影
（工具目录与与之同源的 `tool:<工具名>` section）与执行层 guard 读同一份；三个开关按会话生效。
_避免使用_：白名单收窄（收口不只有白名单）；`ctx.sessionToolScope`（已不存在）

**抑制面**：
官方那两行**在装配投影之外**自己往 `agent/pre-step` 里 append 的注入：`agent-instructions`（工作区指令）与
`skill-catalog`（技能目录）。收口在 `agent/pre-step` 上（`prepend`，最外层）按开关丢掉它们——不动注册表、也不动
它们所在的行。丢只发生在开关为 `false` 时（无条件丢，不看首次还是增量）；开关为 `true`（或缺省为要）时这条监听器
零干预，官方那两行的注入节奏照旧。没 apply 过的会话完全不动。

**三个开关**：
`instructions`（instruction 类注入：丢官方工作区指令 + 关通道的降级注入）、`skills`（技能目录：丢官方
`skill-catalog` 注入）、`runtimeContext`（动态快照：`agent.ctx.systemPrompt.suppressRuntimeContext()`）。
`instructions` 与 `runtimeContext` 缺省为要；`skills` 缺省**由工具名单推导**。

**skills 推导**：
`skills` 不写时的判据：`(allowTools 留空 ? 全部 : allowTools) − denyTools` 含 `skill` 就要技能目录
（`modes.ts` 的 `derivedSkills`）。它只管**注入面**——`skill` 工具本身能不能用归 `allowTools`。

**persona**：
模式的两段提示词文本，注册成**该 agent 的 scope** 上的 `deployment:persona-prefix` / `-suffix` section（缺省是空串，
即遮蔽部署级那层）。

**policy 名单**：
`allowPolicies` / `denyPolicies`：本包在行 ctx 上 `prepend` 上游两条 waterfall（`fs/write-intent` /
`fs/edit-intent`），按会话现算哪条规则生效。**改写的是上游裁决，不是工具可见性**，所以落点不在收口。
