# CONTEXT

skill 目录与加载工具的词汇。只服务 `packages/context/dsh-context-skill-catalog/`。

| 词           | 含义                                                              |
| ------------ | ----------------------------------------------------------------- |
| skill 目录   | `skill-catalog` 规则块：一行 `名字: 摘要`，只列模型可调用的 skill |
| 虚拟 skill   | 运行时注册、没有资源目录的 skill；正文只有 `<skill_instructions>` |
| `skill` 工具 | 模型侧按名字加载 skill 正文的入口（渲染虚拟 skill 形态）          |
