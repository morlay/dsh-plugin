# skill 目录与加载工具

skill 目录与加载工具的词汇。只服务 `packages/context/dsh-context-skill-catalog/`；共用的注入形态
（规则块 / 内容块、虚拟 skill、id、覆盖）见 [context 层 CONTEXT.md](../../.agents/CONTEXT.md)。

## 术语

**skill 目录**：
`skill-catalog` 规则块：一行 `名字: 摘要`，只列模型可调用的 skill。
_避免使用_：技能清单、skill 列表

**`skill` 工具**：
模型侧按名字加载 skill 正文的入口（按虚拟 skill 形态渲染）。
_避免使用_：技能加载器
