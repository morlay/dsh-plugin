# 工具清单与工具说明

`packages/profile/dsh-agent-toolkit/` 的词：一个编码 Agent 有哪些工具（[`rows` 出口](../src/rows.ts)）、
每个工具的说明怎么送达（[`guidance` 出口](../src/guidance/index.ts)）。

## 术语

**pack**：
汉化数据的单位：一份文件一个 pack，形态见 [`src/guidance/types.ts`](../src/guidance/types.ts)。两类——
**工具族**（工具名 + 一行中文）与**用法组**（组定义）。加东西 = 加文件 + 在
[索引](../src/guidance/packs/index.ts) 里登一行；同名/同 key 在汇总时报错。

**族（family）**：
工具类的 pack，一份文件一族（文件、shell、联网、派发、团队……）。
**加一个工具 = 改它所属的族**；同一个工具名出现在两个族里会在汇总时报错（归类错了，不是"后者覆盖前者"）。

**组**：
用法说明的切分单位（`base` / `flow` / `delegation` / `team`），定义在
[`src/guidance/groups.ts`](../src/guidance/groups.ts)。
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

**直接派发 / 团队**：
两种"把活派出去"的形态：`subagent` / `subagent_fork`（直接派发）与 Agent Teams（`spawn_teammate` 那套）。
它们互斥，由 `DSH_AGENT_TEAM=1` 选一套（行清单见 [`TEAM_ROWS`](../src/rows.ts)，`agent-team` 出口转发）。
