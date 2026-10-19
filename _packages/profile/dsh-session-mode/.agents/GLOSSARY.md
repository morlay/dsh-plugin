# 会话模式

本层是 `packages/profile/dsh-session-mode/`：模式（会话级扩展）与**按会话收口**。门面与用法见
[README](../README.md)，形态与应用时机见[设计 会话模式](./designs/20260924-会话模式.md)，收口与三条官方注入面的抑制见
[设计 抑制官方注入面](./designs/20260929-抑制官方注入面.md)，policy 名单见[设计 按模式的policy拦截](./designs/20260929-按模式的policy拦截.md)。
注入形态与信封（规则块 / 内容块、id、覆盖）是注入通道那边的词
（[注入通道的术语表](../../../context/dsh-context-assembler/.agents/GLOSSARY.md)）；工具说明的词在
[`@morlay/dsh-tool-guidance` 的术语表](../../dsh-tool-guidance/.agents/GLOSSARY.md)。

## 术语

**模式**：
`session-mode` 行的 `config.modes` 里的一份定义：persona + 工具名单 + policy 名单 + 三个开关 + 可选的默认模型。
它是**会话级扩展**，不是 Cordis 子树、也不持有行清单（那归会话挂着的 shipped preset）。当前模式是一条会话事实
（事件 `session-mode/selected` + 投影 `sessionMode`）。
_避免使用_：profile（那是装配层的一份 bundle）

**收口**：
本包按会话把模式落到这个 agent 上的那一层（`src/scope.ts` 的 `SessionScope`，模式行内部持有、**不发布服务**）：
工具名单合成、装配投影与执行层 guard、三个开关都按会话生效——名单合成规则（`allowTools` 留空 = 不设收窄、
同名时黑名单优先）住 `ADR-allowTools留空即不设收窄`。
_避免使用_：白名单收窄（收口不只有白名单）；`ctx.sessionToolScope`（已不存在）

**抑制面**：
官方那几行**在装配投影之外**自己往 `agent/pre-step` 里 append 的注入：`agent-instructions`（工作区指令）、
`skill-catalog`（技能目录）与 `time-context`（时钟）。收口在这条瀑布上按开关丢掉它们，判据是开关为 `false`
（`true` 或缺省为要时零干预、官方那几行的节奏照旧）；怎么丢、代价多少见 `设计 抑制官方注入面`。

**三个开关**：
模式里管注入面的三个布尔：`instructions`（instruction 类注入）、`skills`（技能目录）、`runtimeContext`
（动态快照与时钟）。`instructions` 与 `runtimeContext` 缺省为要；`skills` 缺省由工具名单推导（见 `skills 推导`）；
各自关掉什么、开关的两侧见 `设计 抑制官方注入面`。

**skills 推导**：
`skills` 不写时的缺省：由这个模式自己的工具名单推导——名单含 `skill` 就要技能目录。它只管**注入面**；
`skill` 工具本身能不能用归 `allowTools`。

**persona**：
模式的两段提示词文本，注册成**该 agent 的 scope** 上的 `deployment:persona-prefix` / `-suffix` section（缺省是空串，
即遮蔽部署级那层）。

**policy 名单**：
模式自己声明的上游 policy 规则名单：`allowPolicies` / `denyPolicies`。**改写的是上游裁决，不是工具可见性**，
所以落点不在收口——判据与代价见 `设计 按模式的policy拦截`。
