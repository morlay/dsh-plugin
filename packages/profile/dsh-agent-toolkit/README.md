# @morlay/dsh-agent-toolkit

**agent 的工具清单与工具说明**：一个编码 Agent 该有哪些工具（`rows` 出口），以及这些工具怎么被讲清楚
（`guidance` 出口）。另有 Agent Teams 那套可选能力（`agent-team` 出口）。

| 出口                      | 是什么                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| `./rows`                  | 功能行清单：shell、文件、任务、skill 发现、goal、压缩、委派与工作流、问答、todo、联网、交付物 |
| `./guidance`              | 工具说明：短描述汉化、schema 精简、用法分组（组 skill）、丢弃上游说明                        |
| `./agent-team`            | Agent Teams 那一组行，**默认关闭**（`DSH_AGENT_TEAM=1` 才装）                                |
| `./cordis.patch.yml`      | 把整套功能行插到 host 平面（给 profile 直接装配用）                                          |

## 两种采用方式

- **preset 引用它**（[`@morlay/dsh-agent-preset`](../dsh-agent-preset/README.md) 的 coding / chat 就是这么做的）：
  行住进那个 preset 的子树，只有那个模式才有这些能力；`guidance` 行 `inject` 注入通道，所以与组装行同住
  那个 `isolate` 组。
- **profile 列出它**（`dsh.profile.bundles`）：`cordis.patch.yml` 把整套功能行插到 host 平面，整份部署
  （含官方 preset）都能看到这些工具。

两种方式共用 `src/rows.ts` 这一份真源，别同时用。`guidance` 的 `groups: false` 表示只要工具预处理、
不注册用法分组（chat 用它）。

## 汉化精简：族索引

数据以 **pack** 为单位（[`src/guidance/packs/`](./src/guidance/packs/index.ts)）：一份文件一个 pack，
**加一份文件 + 在索引里登一行**。两类 pack 同一形态（[`types.ts`](./src/guidance/types.ts)）：

- **工具族**（`fs` / `shell` / `web` / `team` / …）：一组工具的一行中文——**加一个工具 = 改它所属的族**；
- **用法组**（`group-base` / `group-flow` / …）：一段用法正文、成员工具、注入方式与丢弃清单——加一个组 =
  加一份文件。

两处都有 fail-loud 检查：同一个工具名出现在两个族里、或两个 pack 声明同一个组 key 时当场报错（归类/命名错
了，不是"后者覆盖前者"）。[`src/guidance/groups.ts`](./src/guidance/groups.ts) 是汇总层（组表、短描述表、
正文渲染），不再自己放数据。

运行时（`./guidance`）做三件事：把工具描述换成一行中文、剥掉 schema 里的说明性字段（它们常驻请求）、把
用法按组交给注入通道（`base` 常驻，其余按需加载）。它 `inject` 注入通道——通道的 home 是
[`@morlay/dsh-context-assembler`](../../context/dsh-context-assembler/README.md)（本包只提供数据与运行时，
通道只做上下文重排）。

## Agent Teams：可选

[`./agent-team`](./src/agent-team.ts) 给一组默认关闭的行（上游实验能力：roster / 消息 / 共享任务 + 模型侧
工具 + Web UI），上游自带 `dsh-experimental-agent-team-profile` bundle 做同样的事。开关是运行期
（`!!js process.env.DSH_AGENT_TEAM !== '1'`），所以同一个产物在需要时打开即可；团队装上来时，上面清单里
"直接派发"那几行（`subagent` / `subagent_fork` / 控制行）自动让位——两者不会同时装。

## 边界

| 归这里                                   | 不归这里                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| 工具行清单、工具短描述、用法分组正文     | 提示词（persona）与能力开关 → [dsh-agent-preset](../dsh-agent-preset/README.md) |
| 工具投影的预处理（描述 / schema）        | 注入通道本身 → [dsh-context-assembler](../../context/dsh-context-assembler/README.md) |
| Agent Teams 那套可选行                   | 部署级配置值（llm route、搜索后端、沙箱规则）→ [dsh-profile](../dsh-profile/README.md) |

引用的都是上游 `@deepseek-ai/dsh-*` 能力包（本包只发布"清单 + 说明 + 行 id"，不发布它们的实现）。

## 文档

- 设计与取舍：[设计 工具用法分组](./.agents/designs/20260921-工具用法分组.md)、
  [ADR 工具 schema 恒定而说明动态化](./.agents/adrs/20260920-工具schema恒定而说明动态化.md)
- 术语：[.agents/CONTEXT.md](./.agents/CONTEXT.md)
