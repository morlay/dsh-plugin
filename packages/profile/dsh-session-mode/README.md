# @morlay/dsh-session-mode

模式是**会话级的扩展**：它给一个会话加一段 persona、几份名单（工具 / 技能 / 上游 policy 规则）、三个注入开关，
外加可选的默认模型。它不持有行清单——工具、命令、压缩、委派那些由会话挂着的 shipped preset 提供；模式只决定
「这个会话怎么用它们」。

## 配置从哪来

三层，逐层覆盖：

| 层 | 存在哪 | 谁写 |
| --- | --- | --- |
| 内置默认 | `src/mode-sources.ts`（`MODE_SOURCES`） | 代码 |
| 模式默认 | `{dshHome}/modes/<模式 id>.toml` | 面板「保存为默认」；也可以手写 |
| 会话覆盖 | `storageDomain` 的 `session_mode` 域（按 `SessionId` 一行） | 面板「应用到会话」 |

合成只有一处：`definitionFor` 拿模式默认归一化后叠会话覆盖（有覆盖用覆盖，没有用默认）。能力面与注入面都只读这一份，
谁都不自己去读 TOML 或会话覆盖。

本部署三个模式：`coding`（完整编码 Agent，不设工具收窄）、`chat`（只提问与联网三件）、`noop`（原样模式：
persona 空、名单全空、开关走默认，装配结果与「没有模式」一致——按上游默认跑、或排查扩展干扰时的对照档）。
`noop` 是保留 id，用户文件不能覆盖它。

模式**不限制 preset**：`presetsOnly` 是可选白名单，留空就是不限制、切模式不换 preset；写了才把当前那份落进名单
（已在名单里就不动，否则换成第一个）。模式不是 Cordis 子树，选择落成会话事实（`session-mode/selected` 事件 +
`sessionMode` 投影）。

## 能力面与展示面是两件事

**能力面**（工具能不能调）只由 `allowTools` / `denyTools` 决定。两份名单留空就是不设收窄；同名同时命中时黑名单优先；
名单里可以写组引用（`group:<组 id>` / `mcp:<server>`），收窄前展开成组内工具名。收窄落在 `tools.restrict`，
所以目录与执行读同一份视图——收窄掉的工具调用直接是 `UNKNOWN_TOOL`。

**展示面**（说明什么时候送到模型眼前）只由工具组的 `injection` 决定（组归属的 home 是 [`src/shared.ts`](./src/shared.ts)
的 `toolGroupOf` / `isOnDemandToolGroup`，`injection` 那份数据归 `@morlay/dsh-tool-guidance`）：

| 档 | 哪些组 | 说明怎么到模型 | 能力面 |
| --- | --- | --- | --- |
| `init`（常驻） | 文件、Shell、技能、提问、代码执行 | 随系统提示注入正文与 d.ts | 与按需组完全等价 |
| `on-demand`（按需） | 计划、协作、联网、每个 MCP server（`mcp:<server>`） | **不进系统提示**；模型用 `describe_tool({ group })` 现取 | 与常驻组完全等价 |

按需组省下的是系统前缀里的字节：它们的 section（`tool:<工具名>`、MCP server 自己带的 `mcp:<server>` instructions、
`mcp-resource-servers` 的服务器清单）在装配结果里被摘掉，摘下来的正文由 `describe_tool` 送达。
**能不能调只由那两份名单决定**——按需组的工具照样可以 `await tools.xxx(...)`。

`describe_tool` 的数据源是当前会话可见的工具视图（含这一步的准入集，所以带 `when` 条件的工具只在能调时列出），
清单只列按需组，列出的每个名字都保证可调用。问一个常驻组会被告知「签名已在系统提示里」，问一个不存在的组会拿到
可取组清单——不返回空串，那对模型等于静默失败。

## 三个注入开关

它们管的是**每步请求里额外塞进去的文本**，与工具可见性无关：

- `instructions`：官方 `agent-instructions` 的每次注入（`AGENTS.md` 之类）加重通道自己的降级注入。
- `skills`：官方 `tool-skill` 的**技能目录**（`skill` 工具本身照旧可见）。**不写就按这个模式自己的工具名单推导**：
  `(allowTools 留空 ? 全部 : allowTools) − denyTools` 里含 `skill` 就要。本部署三个模式都不写它——`coding` 与
  `noop` 留空名单 → `true`，`chat` 的三件里没有 `skill` → `false`。要「工具收窄但目录照旧列」就显式写 `skills: true`。
- `runtimeContext`：动态快照（文件沙箱策略、审批策略）与时钟（`time-context`）。

开关为 `true`（或缺省）时**零干预**：官方那几行的注入节奏照旧。抑制的接缝、代价与成对判据见
[设计 抑制官方注入面](./.agents/designs/20260929-抑制官方注入面.md)。

## 技能名单与 policy 名单

**技能名单**（`allowSkills` / `denySkills`）收的是技能名，合成规则与工具名单同一套（留空 = 不设收窄，deny 优先）。
收窄落在两处：`skill-catalog` 那条消息的**正文**（删掉 ``- `<名字>`: <说明>`` 那几行；`source.entries` 是官方发布的
记录、也是官方判「目录变没变」的输入，**不动它**），与 `skill` 工具的**调用参数**（拒的是它这次要加载的那一件）。
**不碰注册表**：技能照旧注册着，收的是「模型看到什么、能加载什么」。

代价与失效方式：正文删行认的是官方渲染形状（``- `<名字>`:`` 行首）。上游改了这个形状时那**一条目录消息整条不动**
（宁可多列一个名字，也不删错行），并打一条点名告警——那是这条名单面唯一的失灵信号。技能名是模型可见契约，跟着
上游改名走。

**policy 名单**（`allowPolicies` / `denyPolicies`）改的是**上游裁决**，不是工具可见性：列出的规则被禁用，它的裁决
连拒绝一起丢掉，调用按「没有这条规则」继续。本部署 `coding` 只禁 `fs/edit-intent`（免「先读后改」），写那条的 CAS
安全网留着。`bash` 之类自己写文件的通路不经过那两条 waterfall。取舍见
[设计 按模式的 policy 拦截](./.agents/designs/20260929-按模式的policy拦截.md)。

## 写错会在装载时拒绝

`default` 必须在清单里且声明 `main`；`role` 不能是空数组；`defaultModel` 要成对给全 `provider` 与 `model`；
`allowPolicies` / `denyPolicies` 里的名字必须是 `POLICY_NAMES` 里的（`fs/write-intent` / `fs/edit-intent` /
`fs/delete-intent`）；退役的单个 `preset`（现已换成 `presetsOnly`）与退役的顶层 `models` 还配着值也拒绝。
改动等 Loader 重挂这一行生效，**已运行会话不自动换定义**。

## 换模式

只有**空白会话**能换（投影 `sessionModeEditable` 在第一次 `turn/start` 之后为 `false`）——历史与装配必须对得上。
换模式先收回旧的一份（persona 的 effect、收口那边的 effect 树与执行层 guard），再装新的；preset 不换（`presetsOnly`
留空时）。子代理默认继承父当前模式，并把继承写进子会话日志。

## 页面

client 半与 host 半同包（`./client` 入口）。两个座位：

| 座位 | 呈现 |
| --- | --- |
| `conversation.input.left`（id `session-mode`） | composer 工具行左侧的模式 chip，点开是切换列表 |
| `sidebar.right.pane.tab`（id `@morlay/dsh-session-mode`） | 右栏面板：这个会话选中的模式与它当下生效的那一份 |

chip 有两个形态：**空白期是选择器**，会话开过 turn 之后**只读**。面板按折叠组排（通用配置 / 系统提示词 / 工具 /
技能 / policy），工具、技能、policy 逐条给出 id 与描述（全量目录，不是收窄后的结果），工具还按组提供整组开关；
组级选择写成一条组引用（`mcp:<server>` 或 `group:<id>`），不用逐个列。每项可改的值都是**会话级覆盖**，
host 立即重装这份收口，并标出来源是会话覆盖还是模式默认。底部三个动作：**保存为默认**（写回
`{dshHome}/modes/<id>.toml`）、**另存为**（以当前生效配置新建一个模式）、**删除**（部署默认模式不可删）。

会话当下生效的那一份走 host 的 `GET /api/morlay/v1/session-mode?sessionId=<id>`；面板的数据来自这条面。

## 用法

自定义就是改三层配置里的任意一层。给 `coding` 换句提示词、收窄工具、或换默认模型，都不需要动插件行：

```toml
# {dshHome}/modes/coding.toml
name = "编码模式"
description = "功能完整的编码 Agent。"
role = [ "main", "subagent" ]
allowTools = []                                            # 留空 = 不设收窄（用 preset 的全部工具）
denyTools = [ "load_workspace_dependencies", "plugin_manager" ]  # 黑名单；可以写 group:<id> / mcp:<server>
allowSkills = []                                           # 留空 = 不设收窄
denySkills = [ "office-docx", "office-pptx", "office-xlsx" ]
denyPolicies = [ "fs/edit-intent" ]                        # 只免「先读后改」，写那条的 CAS 安全网留着
instructions = true
skills = true                                              # 不写则按工具名单推导
runtimeContext = true

[persona]
prefix = """
你是……」
"""
suffix = ""

# 可选：切模式时把会话的 preset 落进这份名单；不写 = 不限制
# presetsOnly = [ "standard", "minimal" ]

# 可选：这个模式的默认模型，只在会话尚无模型事实时接管
# [defaultModel]
# provider = "amr"
# model = "deepseek-v4.1-flash"
```

本包的实现、验证方式与取舍：

- 收口与状态机：[`src/scope.ts`](./src/scope.ts)；形态与应用时机见[设计 会话模式](./.agents/designs/20260924-会话模式.md)。
- 装配入口在 [`@morlay/session-mode-profile`](../../bundles/session-mode-profile/README.md)——本包不装配任何行。
- 验证分三层跑：见[验证规范](./.agents/standards/how-to-verify.md)。
- 词表：[`.agents/GLOSSARY.md`](./.agents/GLOSSARY.md)。
