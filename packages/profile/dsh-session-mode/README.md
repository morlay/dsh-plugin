# @morlay/dsh-session-mode

**模式 = agent preset 的会话级扩展**：每个模式给这个会话加六样东西——一段 persona、两组按名收窄的名单（工具与技能
各自允许哪些、另外禁掉哪些）、一份 policy 名单（哪些上游裁决规则生效）、instruction / 技能目录 / 动态快照三个开关，
外加可选的默认模型。模式**不限制 preset**：行清单（工具 / 命令 / 压缩 / 委派）由会话挂着
的那份 preset 提供，本部署用官方 shipped `standard`（registry 的默认由官方 web-app 给，我们不覆盖）；
`config.modes.<id>.presetsOnly` 是可选的白名单，留空就是不限制、切模式不换 preset，写了才把当前那份落进名单
（已经在名单里就不动，否则换成名单第一个）。模式清单与默认值就是本行的 `config.modes`：真源在
[`src/mode-sources.ts`](./src/mode-sources.ts)，行 config 由 [`src/rows.ts`](./src/rows.ts) 渲染；**模式不是 Cordis
子树**，选择落成会话事实（`session-mode/selected` 事件 + `sessionMode` 投影）。会话里选模式走本包 client 半的 chip
与 `GET/POST /api/morlay/v1/session-mode`，且只在**空白会话**成立。本部署三个模式：`coding`（完整编码 Agent）、`chat`
（只提问与联网）、`noop`（**原样模式**：一份什么都不加的扩展——persona 空、名单全空、三个开关走默认，装配结果与
"没有模式"时一致；想按上游默认跑、或排查扩展干扰时的对照档）。

**按会话收口也在这个包里**（[`src/scope.ts`](./src/scope.ts)，模式行内部持有、不发布服务）：工具名单、三个开关
（`instructions` / `skills` / `runtimeContext`）与上游那三条注入面（工作区指令 / 技能目录 / 时钟）都按会话生效。
三个开关管的是**每步请求里额外塞进去的文本**（工具可见性归 `allowTools` / `denyTools`）：`instructions` 是官方
`agent-instructions` 的每步注入（`AGENTS.md` 之类）加本通道自己的降级注入，`skills` 是官方 `tool-skill` 的
**技能目录**（`skill` 工具本身照旧可见），`runtimeContext` 是两条动态快照（文件沙箱策略、审批策略）。
机制、抑制面的取舍与代价见[设计 抑制官方注入面](./.agents/designs/20260929-抑制官方注入面.md)与
[设计 会话模式](./.agents/designs/20260924-会话模式.md)。

**工具组只决定"说明怎么送达"，不决定"工具能不能调"**（组归属的 home 是 [`src/shared.ts`](./src/shared.ts) 的
`toolGroupOf` / `isOnDemandToolGroup`，`injection` 那份数据归 `@morlay/dsh-tool-guidance`）：

| 档 | 哪些组 | 正文怎么到模型 | 能力面 |
| --- | --- | --- | --- |
| `init`（常驻） | 文件、Shell、技能、提问、代码执行 | 随系统提示注入正文与 d.ts | 与按需组完全等价 |
| `on-demand`（按需） | 计划、协作、联网、每个 MCP server（`mcp:<server>`） | 不注入；模型用 `describe_tool({ group })` 现取 | 与常驻组完全等价 |

按需只省系统前缀里的字节。**能不能调只由 `allowTools` / `denyTools` 决定**——两份名单留空就是不设收窄，
按需组的工具照样可以 `await tools.xxx(...)`。`describe_tool` 的数据源是当前会话可见的工具视图，清单只列按需组，
所以它列出的每个名字都保证可调用；问一个常驻组会被告知"签名已在系统提示里"，问一个不存在的组会拿到可取组清单。

本包不装配任何行：装配入口在 [`@morlay/session-mode-profile`](../../bundles/session-mode-profile/README.md)
（它插 `session-mode`、通道、工具说明与 subagent 那几行）。

## 用法

自定义就是改这份 config——profile 的用户 patch 层可以整体改写 `config.modes`，也可以只给某个模式换提示词、
工具名单、policy 名单或它挂的 preset，不需要任何插件行：

```yaml
- id: session-mode
  name: "@morlay/dsh-session-mode"
  config:
    default: coding # 新会话的起始模式：必须在 modes 里且是 main 角色
    modes:
      coding:
        name: 编码模式
        description: 功能完整的编码 Agent。
        role: [main, subagent]
        # 上游 `fs-observation-policy` 的两条规则里禁掉改那条（免"先读后改"）；写那条照旧生效（CAS 安全网）。
        denyPolicies: [fs/edit-intent]
      chat:
        name: 对话模式
        description: 只做对话：提问与联网（搜索、抓取）三件工具。
        role: [main] # main = 用户选择器；subagent = 可作子代理 mode 的候选
        persona:
          prefix: 你是一个助手。……
        allowTools: [ask_user_question, web_search, web_fetch] # 留空 = 不设收窄（用 preset 的全部工具）
        denyTools: [load_workspace_dependencies] # 黑名单：从上面那份里减掉；两份同时命中时以这里为准（deny 优先）
        allowSkills: [] # 技能白名单：留空 = 不设收窄（技能注册表里有什么就用什么）
        denySkills: [office-docx, office-pptx, office-xlsx] # 技能黑名单：不进技能目录，`skill` 工具加载它也被拒
        instructions: false # 丢掉官方工作区指令的注入，并关掉通道自己的降级注入
        skills: false # 显式丢掉官方技能目录的注入；**本部署不写这一项**——推导已给出同一个值（见下）
        runtimeContext: false # 动态快照（沙箱策略、审批策略）
        defaultModel: { provider: ollama, model: deepseek-v4.1-flash, reasoningEffort: high }
        # presetsOnly: [standard, minimal]   # 可选白名单：切模式时把会话的 preset 落进名单（已在名单里就不动，否则换成第一个）；不写 = 不限制
```

本包**不注册插件页的配置面**（bundle 配置页已撤）：会话当下生效的那一份走 host 的
`GET /api/morlay/v1/session-mode?sessionId=<id>`——模式名与说明、persona、运行期可见的工具、合成后的技能与 policy 名单、
三个注入开关。右侧栏的 `sidebar.right.pane.tab` 面板读这条面：只展示**这个会话选中的模式**，面板按**折叠组**排（通用配置 / 系统提示词 / 工具 / 技能 / policy），内边距与滚动对齐上游右栏内容；
工具、技能、policy 逐条给出 **id 与描述**（全量目录，不只是名字），工具还按组（MCP 的每个 server 一组、其余按用途）提供整组开关；组级选择写成一条**组引用**
（`mcp:<server>` 或 `group:<id>`），不用把组内工具逐个列进 `denyTools`。组行在组内判定不一致时显示**混合**
（这一档不可选）；点「默认 / 允许 / 禁止」都是对整组的批量改写，所以组里某条被设成禁止之后，总能靠组行的
「默认」退回模式默认。每项可改的值都是会话级覆盖，host 立即重装这份收口，并标出来源是**会话覆盖**
还是**模式默认**。
底部三个动作：**保存为默认**（写回该模式）、**另存为**（弹窗输入名字，以当前生效配置新建一个模式）、
**删除**（弹窗确认，部署默认模式不可删；使用它的会话回到默认模式）。
入口两处：右栏 guide 页上的条目，以及会话新建/切换时自动打开这一页。

`skills` **不写就由这个模式自己的工具名单推导**：`(allowTools 留空 ? 全部 : allowTools) − denyTools` 里含 `skill`
就要技能目录（`allowTools` 留空即"全部"，所以只有 `denyTools` 能把它推成 `false`）。本部署三个模式都不写它：
`coding` 与 `noop` 留空名单 → `true`，`chat` 的三件里没有 `skill` → `false`。要"工具收窄但目录照旧列"就显式写
`skills: true`。

技能名单（`allowSkills` / `denySkills`）收的是**技能名**，与工具名单同一套合成规则（`allowSkills` 留空 = 不设收窄，
两份同时命中时 deny 优先），收窄落在两处：`skill-catalog` 那条消息的**正文**（删掉 ``- `<名字>`: <说明>`` 那几行；
`source.entries` 是官方发布的记录、也是官方判"目录变没变"的输入，**不动它**）与 `skill` 工具的**调用参数**（拒的是
它这次要加载的那一件，工具本身的可见性仍归 `allowTools`）。**不碰注册表**：技能照旧注册着，收的是"模型看到什么、
能加载什么"。本部署用它收官方 Office 面——那三件技能由桌面宿主代码 `ctx.plugin` 挂载（不是 entry 行，profile 层
停不掉），于是 `coding` 按名排除它们，`load_workspace_dependencies` 那件工具同样进 `denyTools`。

代价与失效方式：正文删行认的是官方渲染形状（``- `<名字>`:`` 行首）。上游改了这个形状时那**一条目录消息整条不动**
（宁可多列一个名字，也不删错行），并打一条点名告警——那是这条名单面唯一的失灵信号。技能名是模型可见契约，跟着
上游改名走。日志与页面读到的是官方那份**完整**结构化名单，收窄只在模型可见的正文上——这是刻意的：官方按那份名单
的 digest 判目录要不要重发，改了它会每一步都重发一条目录。

写错在装载时就拒绝：`default` 必须在清单里且声明 `main`、`role` 不能是空数组、`defaultModel` 要给全 `provider` 与
`model`、`allowPolicies` / `denyPolicies` 里的名字必须是上游那两条 waterfall（`fs/write-intent` /
`fs/edit-intent`）、退役的 `preset`（单个 preset 的旧写法）还配着值也拒绝——它已经换成 `presetsOnly`。改动等 Loader
重挂这一行生效，已运行会话不自动换定义。

四处别当成全能开关：`allowTools` **留空就是不设收窄**（用会话挂着的 preset 的全部工具），列了名单时那份 preset
没有的工具会**自动跳过**（会话挂着官方 `minimal` 时 `chat` 一件都不剩）；`instructions: false` 丢的是官方
`agent-instructions` 的每步注入**与**通道自己的降级注入，代价是官方那一行每步仍会重读 `AGENTS.md` 重算一次
（结果被丢掉）；开关为 `true`（或 `instructions` 缺省）时这条抑制**零干预**——官方那两行的注入节奏（首次、以及内容
有变才注入的增量）照旧；`skills: false` 只丢官方目录的注入，`skill` 工具本身的可见性归 `allowTools`；`denyPolicies` 只改
**上游那两条 waterfall** 上的裁决（`tool-fs` 的写 / 改与 `tool-str-replace-editor`），`bash` 之类自己写文件的通路
不经过它们。取舍见 [ADR 模式不绑定 preset](./.agents/adrs/20260929-模式不绑定preset.md)、[ADR allowTools 留空即不设收窄](./.agents/adrs/20260929-allowTools留空即不设收窄.md)、
[设计 按模式的 policy 拦截](./.agents/designs/20260929-按模式的policy拦截.md) 与
[设计 抑制官方注入面](./.agents/designs/20260929-抑制官方注入面.md)。
