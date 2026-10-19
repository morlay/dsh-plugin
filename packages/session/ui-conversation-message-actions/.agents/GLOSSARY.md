# 会话编辑编排面（ui-conversation-message-actions）

本包自己的词：**操作语义**里那几件只在本包成立的事——可编辑范围、重放范围、
空轮形状；跨包的会话编辑词汇（会话、就地编辑、撤回、分支、轮次、闭合边界等）在根
[`.agents/GLOSSARY.md`](../../../../.agents/GLOSSARY.md)，边界表见
[`.agents/GLOSSARY-MAP.md`](../../../../.agents/GLOSSARY-MAP.md)。

## 术语

**空轮（empty turn）**：
已闭合但既无用户输入也无助手回复的轮次（`turn/start` 后直接 `turn/end`）
——既有数据里可能出现的形状；就地编辑与重放怎么处理它见
[设计 编排层操作语义](./designs/20260917-编排层操作语义.md) 的「就地编辑语义」。
_避免使用_：空回合、幽灵轮次

**cascade 策略**：
重放范围：`truncate` 只重放目标输入，`preserve` 重放目标及后续全部输入。
_避免使用_：级联、cascade mode

**可编辑块（editable block）**：
可被 edit 修改的已落定文本块：`user` / `assistant.reasoning` /
`assistant.response`。
_避免使用_：消息块、content block

**轮次切分（turn split）**：
撤回 / 就地重写以目标事件为切点，前序保留、后序丢弃；只排除轮结构与轮正文（核心稳定集合），
其余事件（配置、上下文注入、队伍、压缩…）默认保留。轮内前序正文保留时补 `turn/end(interrupted)`
闭合该轮；首轮撤回等同清空重开（见
[设计 编排层操作语义](./designs/20260917-编排层操作语义.md) 的「就地编辑语义」）。
_避免使用_：白名单补回、事件回填
