# 注入能力组

一个包（`packages/context/dsh-context-assembler/`）承载注入通道与它的注入方，每个能力一个子出口：门面与各出口见
[README](../README.md)，规则与 id 表见[设计 上下文注入规则](./designs/20260921-上下文注入规则.md)。
引用展开是另一个包 [`@morlay/dsh-reference`](../../dsh-reference/README.md)（术语见[那边](../../dsh-reference/.agents/CONTEXT.md)），
这里的「内容块」定义它也用；工具说明的词与数据在
[`@morlay/dsh-agent-toolkit` 的术语表](../../../profile/dsh-agent-toolkit/.agents/CONTEXT.md)。

## 术语

**规则块**：
`<system-reminder id="…">` 包着的持久系统级指令。id 必带，参与覆盖。只有注入通道能写它。

**内容块**：
技能说明与引用的材料：`<skill_content name="…">`（**技能正文一律用它**——随提示常驻送达的与模型按需
加载的同一形态）、`<file_content path="…">`（本步引用的文件内容）。不参与覆盖；幂等键在 source 里
（规则块用 id、内容块用 skill 名）。

**虚拟 skill**：
运行时注册、没有资源目录的 skill（本部署的组 skill 都是）。正文只有 `<skill_instructions>`，
不渲染 `<skill_resources>`。

**id**：
规则块的稳定标识，`<owner>:<key>`（第一个冒号前是 owner）。id 里不放 seq / 时间 / digest 这类易变值。
_避免使用_：条目名（与 skill 名混用）

**覆盖**：
语义覆盖——同 id 的最新一条取代更早的同 id 条目，不重写会话历史；规则在系统提示词里声明一次
（[`rules.ts`](../src/assembler/rules.ts)），所以每条 reminder 只带 id 与正文。

**常驻（auto）/ 按需（on-demand）**：
正文到达模型的两条路，**形态相同**（都是 `<skill_content>`），区别只在谁触发：常驻 = 随 reminder
自动送达（`base` 组用法）；按需 = 目录常驻一行摘要、正文由 `skill` 工具加载。工作区指令与 skill 目录
是规则块，不属于 skill。

**通道**：
`ctx.contextAssembler`（`assembler` 出口）：唯一渲染者与唯一的覆盖判定处。注入方只声明
`{ name, title, description, content, injection? }`、`registerRule({ id, text })` 或 `replaceSection` / `suppressSection`。
全局一份、不隔离——注册表整个部署共享，模式差异由 `scope` 出口按会话收口
（[ADR 通道作为全局服务装配不隔离](./adrs/20260923-通道作为全局服务装配不隔离.md)）。

**面**：
上游那类"整面注入"的内容：工作区指令链是一条面，skill 目录与它的加载工具是另一条面
（[`channel.ts`](../src/assembler/channel.ts) 的"接管上游那两面"说的就是它们）。
与上游的会话 `surface`（被接纳进请求的那份内容）不是一回事，别混用。
_避免使用_：注入面、类别

**让位**：
一条面的注入权按**会话**判给 preset：该会话的 preset 行清单里装了这条面的上游行时，host 平面这一侧一条都不
注入。工作区指令走的就是它。
_避免使用_：去重（去重说的是同 id 覆盖）、认领（认领说的是上游认出我们那条条目，见 `baseline.ts`）

**抢面**：
一条面的注入权按**会话**抢到 host 平面这一侧：把同名工具注册进 **agent 自己那一层**（最里层赢，
遮蔽 preset 与全局那两份），于是上游"这个工具不是我注册的那个"就不发它那份内容。skill 面走的就是它。
让位与抢面是同一条边界的两个方向，判别与代价见
[ADR-20260929-工作区指令让位skill面由通道抢面](./adrs/20260929-工作区指令让位skill面由通道抢面.md)。
_避免使用_：覆盖（覆盖说的是同 id 的条目取代）

### 能力

**skill 目录**：
`skill-catalog` 规则块：一行 `名字: 摘要`，只列模型可调用的 skill。
_避免使用_：技能清单、skill 列表

**`skill` 工具**：
模型侧按名字加载 skill 正文的入口（按虚拟 skill 形态渲染）。
_避免使用_：技能加载器
