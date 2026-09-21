# @morlay/dsh-context-skill-catalog

把 skill 目录注入成规则块、并注册模型侧 `skill` 工具的 cordis 插件。取代上游
`@deepseek-ai/dsh-tool-skill`（该行在 preset 产物里已禁用；`skill-filesystem` 保留，它提供 skill 发现）。

规则与 id 形态见[上下文注入规则](../.agents/designs/20260921-上下文注入规则.md)；术语见
[`CONTEXT.md`](./.agents/CONTEXT.md)。

## 行为

| 环节         | 做什么                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------- |
| 目录         | `skill-catalog` 规则块：`<available_skills>` 一行 `名字: 摘要`，只列模型可调用的 skill      |
| `skill` 工具 | 按名字加载正文；渲染用**虚拟 skill 形态**（`<skill_instructions>`，无 `<skill_resources>`） |

- **目录变更走 id 覆盖**：目录文本随注册表变化，通道按 `skill-catalog` 幂等 + 同 id 覆盖处理；
- **`auto` 的 skill 不进目录**：它标了 `modelInvocable: false`（正文已随提示送达，不该诱导再加载）。

## 装配

[dsh-preset](../../preset/dsh-preset/cordis.patch.yml) 的 patch 里一行（host plane）。
