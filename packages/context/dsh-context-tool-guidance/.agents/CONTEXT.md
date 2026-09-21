# 工具用法分组

工具用法分组的词汇。只服务 `packages/context/dsh-context-tool-guidance/`。

## 术语

**组**：
用法说明的切分单位（`base` / `flow` / `delegation` / `team`），定义在 [`src/groups.ts`](../src/groups.ts)。
_避免使用_：分类、分组表

**组 skill**：
`tool-group-<key>`：该组用法的载体（正文是中文列表）；`base` 常驻，其余按需加载。
_避免使用_：组插件

**注入方式**：
组表里的 `injection`：`auto`（正文随 reminder 常驻）或 `on-demand`（进 skill 目录）。
_避免使用_：投递方式

**丢弃清单**：
组表里的 `drops`：哪些上游说明与规则不再进提示词（要点已写进正文列表）。
_避免使用_：回收清单

**短描述**：
覆盖上游 `description` 的一行中文（只讲做什么）；参数留在 schema、用法留在组 skill 正文。
_避免使用_：工具描述
