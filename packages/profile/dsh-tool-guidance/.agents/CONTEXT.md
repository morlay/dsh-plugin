# 工具清单与工具说明

`packages/profile/dsh-tool-guidance/` 的词：工具说明怎么分组与送达（包根那份运行时
[`src/index.ts`](../src/index.ts)），
以及工具说明那一行（[`rows` 出口](../src/rows.ts)，host 平面）。功能行清单不归本包——它归会话挂着的 agent preset。

## 术语

**pack**：
汉化数据的单位：一份文件一个 pack，形态见 [`src/guidance/types.ts`](../src/guidance/types.ts)。两类——
**工具族**（工具名 + 一行中文）与**用法组**（组定义）。加东西 = 加文件 + 在
[索引](../src/guidance/packs/index.ts) 里登一行；同名/同 key 在汇总时报错。

**族（family）**：
工具类的 pack，一份文件一族（文件、shell、联网、派发、团队……）。
**加一个工具 = 改它所属的族**；同一个工具名出现在两个族里会在汇总时报错（归类错了，不是"后者覆盖前者"）。

**组**：
用法说明的切分单位（`base` / `flow` / `delegation` / `team`）：数据是 [`packs/group-*.ts`](../src/guidance/packs/index.ts)
里的组 pack，汇总与渲染在 [`groups.ts`](../src/guidance/groups.ts)。`base` 的身份由
[`BASE_GROUP_KEY`](../src/guidance/types.ts) 表达，不靠字段。
_避免使用_：分类、分组表

**组 skill**：
`tool-group-<key>`：该组用法的载体（正文是中文列表）。`base` **不进官方目录**（它的正文由本行常驻注入，列一份
出来只会让模型再加载一遍），其余三组注册进官方 `ctx.skills`、按需加载。
_避免使用_：组插件

**送达**：
组正文到模型那条路，共三档：`base` 挂本行 `agent/pre-step` 常驻注入（正文按**这个会话装配结果里最终可见的
工具目录**过滤：收窄掉的工具不列）、其余三组走官方 skill（目录常驻、正文按需）、上游逐工具说明由 `drops` 摘掉。
取舍与代价见[设计-工具说明与用法分组的送达](../.agents/designs/20260929-工具说明与用法分组的送达.md)。
_避免使用_：注入方式、投递方式

**丢弃清单**：
组表里的 `drops`：哪些上游说明与规则不再进提示词（要点已写进正文列表）。
_避免使用_：回收清单

**短描述**：
覆盖上游 `description` 的一行中文（只讲做什么）；参数留在 schema、用法留在组 skill 正文。
_避免使用_：工具描述

**直接派发 / 团队**：
两种"把活派出去"的形态：`subagent` / `subagent_fork`（直接派发）与 Agent Teams（`spawn_teammate` 那套）。
本部署的 preset 只装直接派发；团队那一族的行归上游
`@deepseek-ai/dsh-experimental-agent-team-profile` bundle（那份自带"禁直接派发"），本包的 `team` 组只是它的
用法正文，所以我们不为它留让位门控。
