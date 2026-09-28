# @morlay/dsh-agent-toolkit

**工具说明**（短描述汉化、schema 精简、用法分组）与工具行清单**数据**（`rows` 出口）。工具行本身不在这里装：
它们由官方 agent preset 的行清单提供。另有 Agent Teams 那套可选能力（`agent-team` 出口）。

| 出口                 | 是什么                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `./rows`             | 功能行清单与工具名：shell、文件、任务、skill 发现、goal、压缩、计划模式、委派与工作流、问答、todo、联网；preset 平面那一套（`TOOLKIT_PRESET_ROWS`）也在这一份数据里 |
| `./guidance`         | 工具说明：短描述汉化、schema 精简、用法分组（组 skill）、丢弃上游说明                                                                                               |
| `./agent-team`       | Agent Teams 那一组行，**默认关闭**（`DSH_AGENT_TEAM=1` 才装）                                                                                                       |
| `./cordis.patch.yml` | 只插工具说明那一行（给 profile 直接装配用）                                                                                                                         |

## 装配

`dsh.profile.bundles` 列出本包即完成装配（示例 app 就是这么做的，排在
[`@morlay/dsh-context-assembler`](../../context/dsh-context-assembler/README.md) 之后、配置层之前）：
`cordis.patch.yml` 只插**一行工具说明**（`@morlay/dsh-agent-toolkit/guidance`），它 `inject` 的通道在同一个
平面装一次且不隔离。

**功能行谁装**：行清单由 agent preset 的 `config.plugins` 提供——官方 web-app 正是把这些行的 host 份设成
`disabled: true` 交给 preset 平面挂。本部署自己注册的那份 preset（`mode-switch`，见
[`@morlay/session-mode-profile`](../../../bundles/session-mode-profile/README.md)）直接引用本包的
`TOOLKIT_PRESET_ROWS`；`tool-guidance` 那一行不在其中，它是 host 平面行（往通道这个 host 单例注册正文，
两个平面各一份会互相顶掉）。[`@morlay/dsh-session-mode`](../dsh-session-mode/README.md) 只按会话收口：
`allowTools` 白名单的名单由 `TOOLKIT_TOOL_NAMES` 从汉化数据派生，白名单里 preset 没有的工具自动跳过。
`./rows` 的行清单没有装配动作，它是数据出口。

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

| 归这里                               | 不归这里                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| 工具行清单、工具短描述、用法分组正文 | 提示词（persona）与能力开关 → [dsh-session-mode](../dsh-session-mode/README.md)                        |
| 工具投影的预处理（描述 / schema）    | 注入通道本身 → [dsh-context-assembler](../../context/dsh-context-assembler/README.md)                  |
| Agent Teams 那套可选行               | 部署级配置值（llm route、搜索后端、沙箱规则）→ [dsh-profile](../../../bundles/mydsh-profile/README.md) |

引用的都是上游 `@deepseek-ai/dsh-*` 能力包（本包只发布"清单 + 说明 + 行 id"，不发布它们的实现）。

## 文档

- 设计与取舍：[设计 工具用法分组](./.agents/designs/20260921-工具用法分组.md)、
  [ADR 工具 schema 恒定而说明动态化](./.agents/adrs/20260920-工具schema恒定而说明动态化.md)
- 术语：[.agents/CONTEXT.md](./.agents/CONTEXT.md)
