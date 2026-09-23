# 注入能力组

一个包（`packages/context/dsh-context-assembler/`）承载注入通道与它的注入方，每个能力一个子出口：门面与各出口见
[README](../README.md)，规则与 id 表见[设计 上下文注入规则](./designs/20260921-上下文注入规则.md)。
引用展开已独立成 [`@morlay/dsh-reference`](../../dsh-reference/README.md)（术语见[那边](../../dsh-reference/.agents/CONTEXT.md)），
这里的「内容块」定义它也用。

## 共用术语

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
_避免使用_：条目名（旧说法，与 skill 名混用）

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
**按模式各一份**：通道与它的注入方同住该模式的 `isolate` 组，注册表因此不越界（别的 preset 收不到我们的注入）。

## 能力术语

### skill 目录与加载工具（`skill-catalog`）

**skill 目录**：
`skill-catalog` 规则块：一行 `名字: 摘要`，只列模型可调用的 skill。
_避免使用_：技能清单、skill 列表

**`skill` 工具**：
模型侧按名字加载 skill 正文的入口（按虚拟 skill 形态渲染）。
_避免使用_：技能加载器

### 工具说明（归 toolkit）

工具的汉化精简与用法分组不在这个包里了——它们的词与数据在
[`@morlay/dsh-agent-toolkit` 的术语表](../../../profile/dsh-agent-toolkit/.agents/CONTEXT.md)（族 / 组 / 组 skill /
注入方式 / 丢弃清单 / 短描述）。本包只提供它们注入用的通道。
