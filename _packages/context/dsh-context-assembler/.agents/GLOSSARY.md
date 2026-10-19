# 注入通道

一个包（`packages/context/dsh-context-assembler/`）承载提示词通道：门面与出口见
[README](../README.md)，形态与覆盖语义见[设计 上下文注入规则](./designs/20260921-上下文注入规则.md)，本包留什么见
[设计 通道只做转换](./designs/20260929-通道只做转换.md)。按会话的工具收口与三个注入开关是另一个包的事
（[`@morlay/dsh-session-mode`](../../../profile/dsh-session-mode/README.md)，那边的术语表见
[它](../../../profile/dsh-session-mode/.agents/GLOSSARY.md)）。
引用展开是另一个包 [`@morlay/dsh-reference`](../../dsh-reference/README.md)（术语见[那边](../../dsh-reference/.agents/GLOSSARY.md)），
这里的「内容块」定义它也用；工具说明的词与数据在
[`@morlay/dsh-tool-guidance` 的术语表](../../../profile/dsh-tool-guidance/.agents/GLOSSARY.md)。

## 术语

**规则块**：
`<system-reminder id="…">` 包着的持久系统级指令：id 必带、参与覆盖。

**内容块**：
技能说明与引用的材料：`<skill_content name="…">`（技能正文一律用它）、`<file_content path="…">`（本步引用的文件内容）。
不参与覆盖，幂等键是 skill 名。

**虚拟 skill**：
运行时注册、没有资源目录的 skill（本部署的组 skill 都是）。

**id**：
**规则块**的稳定标识，也是它的覆盖与幂等键：`<owner>:<key>`（第一个冒号前是 owner）。只放稳定值，不放
seq / 时间 / digest 这类易变值。
_避免使用_：条目名（与 skill 名混用）

**覆盖（语义覆盖）**：
同 id 的最新一条取代更早的同 id 条目，不重写会话历史；只适用于规则块，内容块不参与。

**常驻（auto）/ 按需（on-demand）**：
正文到达模型的两条路，**形态相同**（都是 `<skill_content>`），区别只在谁触发：常驻 = 随 reminder 自动送达
（`tool-guidance` 的 `base` 组）；按需 = 官方 `tool-skill` 的目录常驻一行摘要、正文由 `skill` 工具加载。工作区指令是
规则块，不属于 skill。

**通道**：
`ctx.contextAssembler`（包根就是它）：装配结果上的文本转换与降级 section 的按步送达，不给扩展点（没有注册面）。
全局一份、不隔离——服务整个部署共享；模式差异不在这里表达
（[ADR 通道作为全局服务装配不隔离](./adrs/20260923-通道作为全局服务装配不隔离.md)）。
