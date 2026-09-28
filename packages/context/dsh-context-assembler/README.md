# @morlay/dsh-context-assembler

提示词注入能力组：**一个包四个能力**——主出口是组装插件（所以装配面只有一行），各能力另有子出口可单独装；
能力名就是子出口名。装配行是 `@morlay/dsh-context-assembler`（组装）或 `@morlay/dsh-context-assembler/<capability>`（单个），
见 [`src/rows.ts` 的 `contextChannel()`](./src/rows.ts)。引用展开原先也在这个包里，
现在独立成 [`@morlay/dsh-reference`](../dsh-reference/README.md)（它只挂 `agent/pre-step`、不依赖通道）。

| 出口                   | 行 id / 插件 name                                         | 做什么                                                                       |
| ---------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `.`                    | `context-assembler`（插件 name `context-assembler-tree`） | **组装出口**：按 config 决定装哪些能力、各带什么参数（缺省即四套能力）       |
| `./assembler`          | `context-assembler`                                       | 注入通道：唯一渲染者与唯一覆盖判定处，发布 `ctx.contextAssembler`            |
| `./agent-instructions` | `context-agent-instructions`                              | 工作区指令链（`$DSH_HOME/AGENTS.md` + 项目根到 cwd 逐级）                    |
| `./skill-catalog`      | `context-skill-catalog`                                   | skill 目录规则块 + 模型侧 `skill` 工具                                       |
| `./scope`              | `context-assembler-scope`                                 | 按会话收口：工具白名单、instruction 总开关、动态快照开关（模式把定义推给它） |

规则、id 表与分层的 home 在 [上下文注入规则](./.agents/designs/20260921-上下文注入规则.md)；术语见
[本包 CONTEXT](./.agents/CONTEXT.md)。

## 装配

`dsh.profile.bundles` 列出本包即装**一次**：`cordis.patch.yml` 是一行组装出口（显式给三项能力：通道本体、
`agent-instructions`、`skill-catalog`；config 的 `capabilities` 缺省是全部四项）。**不做隔离**——工具说明
（[`@morlay/dsh-agent-toolkit`](../../profile/dsh-agent-toolkit/README.md) 的 `guidance`）这类消费者住在别的包里，
隔离会把它们挡在组外（行停在 waiting，不报错）；理由见
[ADR 通道作为全局服务装配不隔离](./.agents/adrs/20260923-通道作为全局服务装配不隔离.md)。`scope` **不在这份 patch 里**
——它是模式那一层的收口行，由 [`@morlay/dsh-session-mode`](../../profile/dsh-session-mode/README.md) 的 patch 与模式定义
一起装（行 id 与 name 归本包的 `scopeRow()`，单一 home）。

装一次不等于每次都注入：这两条面各自按**会话**判归谁——`agent-instructions` 在预设自带那一行时**让位**，
`skill-catalog` 反过来把同名工具注册进 agent 自己那一层**抢面**（见下面两节）。所以 `capabilities` 不在装配期
按模式裁。

工具说明（汉化 / 精简 / 用法分组）也不在这里：它归
[`@morlay/dsh-agent-toolkit`](../../profile/dsh-agent-toolkit/README.md)，同样在 profile 平面装一次。

## 装配形态

本包是 bundle：`cordis.patch.yml` 由 [`src/rows.ts`](./src/rows.ts) 从 [`src/rows.ts`](./src/rows.ts) 渲染，
`rows` 出口导出同一份清单。`dsh.profile.bundles` 列出本包即装一次，**服务全局共享、不隔离**；模式的收口是
另一行（`scopeRow()`：工具白名单 / instruction / 动态快照），别的包的行（工具说明、skill 目录）直接 `inject`
同一份通道。

## 为什么合成一个包

这 4 个能力**总是一起装配**（通道在装配平面装一份、不隔离：注入方住在别的包里，隔离会把它们挡在组外），
注入方**全都只用通道的类型与服务面**。包边界在这里只是演进留下的：合成一个包之后，加一个能力 = 加一个子出口，装配面不动
（组装出口按 config 装它）。

工具说明（汉化精简 + 用法分组）也不住在这里：它管的是"工具怎么被讲清楚"，与工具的清单同源，
现在归 [`@morlay/dsh-agent-toolkit`](../../profile/dsh-agent-toolkit/README.md)（它也 `inject` 通道，装的是同一份
全局通道）。本包只做上下文重排。

引用展开不住在这里：它不依赖 `ctx.contextAssembler`（`inject` 只有 `skills`），也没有「读文件 + 字节预算」
以外与组装出口共享的东西，所以独立成包、由 [`@morlay/better-session`](../../../bundles/better-session/cordis.patch.yml)
装配（见 [ADR-引用展开拆成独立包](../../../.agents/adrs/20260923-引用展开拆成独立包并按profile装配.md)）。

**每个出口仍是独立的 cordis 插件**（各自的 `apply` 与 `inject`）——这一点是硬要求：合成单入口会让 `inject`
变成并集（`agents, contextAssembler, skills, systemPrompt, tools`），任何一个可选搭档缺席都拖垮整包。

## assembler

注入的唯一通道。system prompt 里只留 `keep`（部署 persona + 覆盖规则），其余 section 按处置分流：丢弃
（平台说明）、改写（两段中文文案）、或降级成规则块；pre-step 时把要送的内容逐条以 `<system-reminder>`
user 消息注入（每条按文本幂等，只有变化的那条重发）。

| 声明                                  | 到达方式                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| `registerSkill` + `on-demand`         | 注册成模型可用 skill：目录常驻一行摘要，正文由 `skill` 工具加载                  |
| `registerSkill` + `auto`              | 正文随 reminder 常驻；skill 标 `modelInvocable: false`（用户仍可 `skill:` 引用） |
| `registerRule({ id, text, source? })` | 规则块，幂等键是 `id`；`source` 声明对外身份                                     |
| `replaceSection` / `suppressSection`  | 装配结果上的文本改写 / 丢弃                                                      |
| `setInstructions` / `restrictTools`   | 按会话登记模式的两处收口（不要 instruction / 工具白名单）                        |
| `visibleTools(agent, registered)`     | 合成该会话的工具可见性：注册表可见 × 已登记的白名单（目录与组正文共用）          |
| `hiddenSkills(visible)`               | 声明了 `requires` 而入口工具一个都不可见的 skill 名                              |

配置（`keep` / `suppress` / `replace`）的默认值在 [`src/assembler/defaults.ts`](./src/assembler/defaults.ts)。
**全局一份、不隔离**：模式差异由 `context-assembler-scope` 登记（`setInstructions` / `restrictTools`）收口，跨包的
消费者（工具说明、技能目录）直接 `inject` 同一份通道（见
[ADR 通道作为全局服务装配不隔离](./.agents/adrs/20260923-通道作为全局服务装配不隔离.md)）。

## agent-instructions

`$DSH_HOME/AGENTS.md` 加项目根到 cwd 的逐级 `AGENTS.md` / `AGENTS.local.md`，**一条文件一条 id**
（`agent-instructions:<根标识>:<文件>`，根标识是根目录的 8 位摘要——同进程两个项目根的同名文件因此不会互相
顶掉），文件变化时只重发变了的那一份。取代上游 `@deepseek-ai/dsh-agent-instructions`（host 那行由上游
web-app bundle 自己设在装配层；我们那份由本包的组装出口在 profile 平面装）——**在该会话的 preset 行清单没有
上游那一行时**。

- **preset 自带那一行时让位**：官方 `standard` / `ptc` / `cordis` 的 preset 行清单里有
  `@deepseek-ai/dsh-agent-instructions`（`minimal` 没有），装上的会话由 preset 侧注入，这一条一条都不注入；
  `chat` 挂的 `minimal` 会话仍由我们提供。判据与理由见
  [ADR-工作区指令让位skill面由通道抢面](./.agents/adrs/20260929-工作区指令让位skill面由通道抢面.md)。
- **不跟踪 `read`/`write`/`edit`**：上游靠 touch 上浮触发刷新；本部署的 `AGENTS.md` 几乎不变，按
  `mtime:size` 对账足够。
- **超预算可见**：单文件超过 `maxBytes` 时截断并留一行提示，不静默丢内容。
- **与上游的 baseline 认领对齐**：`source` 带 `kind: "agent-instructions"` + `baseline: true` +
  `baselineIdentity`（身份与上游 `workspaceBaselineIdentity` 逐字相等）。上游的认领判据只看本步 claimed 的
  消息与会话 surface，所以它救不了首步两侧同时注入（那由让位管），但管得住另一件事：**我们注入过基线的历史
  会话在 preset 会话里恢复时**，上游认得出那条、不再补一份自己的模板（"Use them as guidance…"）。
- 配置：`instructionFileCandidates` / `localInstructionFileCandidates`（覆盖成只读 `AGENTS*`，不含 CLAUDE
  系列）、`maxBytes`（65536）、`dshHome`。

## skill-catalog

`skill-catalog` 规则块（`<available_skills>`，一行 `名字: 摘要`，只列模型可调用的 skill）加模型侧 `skill`
工具。取代上游 `@deepseek-ai/dsh-tool-skill`（`skill-filesystem` 保留——它提供 skill 发现）。目录变更走同 id
覆盖；`auto` 的 skill 不进目录（正文已随提示送达）。

**这一面归通道**（工作区指令那一面相反，是让位）：`skill` 工具按**会话**注册进 agent 自己那一层，最近的一层
赢，遮蔽 preset 那份；上游的目录发布判据是"它自己注册的那个工具是本会话可见的那个"，被遮蔽之后它不发目录，
目录由我们发布。要点：

- 目录那条注入消息的 **kind 是我们自己的**（`context-assembler` + `form: "catalog"` + `entries`）。上游把任何
  `kind: "skill-catalog"` 且条目可读的消息当成它自己的账本：kind 用它的，它会在首步删掉我们这条、在有可见
  目录之后补一条"没有可用 skill"把目录顶掉（它文档里的 visibility-loss 语义）。`form` 与 `entries` 照旧，
  客户端那张条目表不受影响；注入行的标签变成 `context-assembler`。
- 按会话注册随 agent 收回；这一行重挂（HMR / 设置面）时不再重复注册同一份定义。
- `chat`（挂 `minimal`，没有上游那一行）：工具与目录同样是我们提供的，但它的模式定义不收这两样
  （`instructions: false`、白名单里没有 `skill`）——白名单把它挡在模型目录外，执行层 guard 拒绝调用。

取舍与上游判据见 [ADR-工作区指令让位skill面由通道抢面](./.agents/adrs/20260929-工作区指令让位skill面由通道抢面.md)。

## 工具说明（不在这个包里）

工具的汉化精简与用法分组归 [`@morlay/dsh-agent-toolkit`](../../profile/dsh-agent-toolkit/README.md) 的 `guidance` 出口：
族索引（加一个工具改一族）、组 skill、短描述投影、丢弃清单都在那边。它 `inject` 通道，装的是同一份全局通道
——本包只提供它们要用的通道，不碰工具怎么讲。

## scope

按会话收口的出口（行 id `context-assembler-scope`）：工具白名单（装配期投影 + 执行层 guard + 与工具同源的
`tool:<工具名>` 说明 section，三侧同判据）、`instructions`（关掉一切 instruction 类送达：常驻组正文、规则块
与降级 section；按需 skill 与 `@` 引用材料不受它管）、`runtimeContext`
（关掉沙箱 / 审批那两条动态快照，按 scope 抑制）。

**定义由消费方推给它**，它自己不认识"模式"：`ctx.sessionToolScope.apply(agent, mode)` 是唯一入口，落在该
agent 的 `ctx` 上（抑制器、guard 都在那里），同一个 agent 再 apply 一次就是换一份——旧的 effect 树收回、按新
的装一遍。它解决的是"模式只能决定加什么、管不了 host 平面"：`dsh.profile.bundles` 打开的包（工具行、
实验性的 Agent Teams）在 host 平面插行，对所有会话一视同仁；模式要表达"我只有这几个工具、一条提示词都不要"
时，唯一与来源无关的做法是在会话语义上收口。

白名单同时登记给通道（`restrictTools`）：技能目录与用法组正文按 `visibleTools` 收口，所以被收窄的工具既不在
目录、也不会被讲——注册表里"装着"不等于这个会话"能用"。

## 装配

**profile 平面**：`dsh.profile.bundles` 列出本包即装一次，`cordis.patch.yml` 就是一行组装出口：

```yaml
- insert:
    - id: context-assembler
      name: "@morlay/dsh-context-assembler"
      config:
        capabilities: [assembler, agent-instructions, skill-catalog]
```

**模式平面**：收口那一行（不带 config——模式定义在 `session-mode` 行的 `config.modes` 里）由
[`@morlay/dsh-session-mode`](../../profile/dsh-session-mode/README.md) 的 patch 装，通道由 profile 那份共享：

```yaml
- id: context-assembler-scope
  name: "@morlay/dsh-context-assembler/scope"
```

几点硬要求：

- **每个能力仍是独立的 cordis 插件**（组装出口只是 `ctx.plugin()` 装它们），各自带自己的 `inject`；合成单入口会让
  `inject` 变并集，一个可选搭档缺席就拖垮整包。
- **通道不做隔离**：消费者跨包（`@morlay/dsh-agent-toolkit` 的工具说明、本包的技能目录），隔离会把它们挡在组外
  （行停在 waiting）；模式差异改由 `context-assembler-scope` 登记给通道，见
  [ADR 通道作为全局服务装配不隔离](./.agents/adrs/20260923-通道作为全局服务装配不隔离.md)。真装配的判据是
  `pnpm exec tsx packages/desktop/dsh-desktop-host/tool/verify-session-mode.mts`（装配层可见一份、收口行装上、
  官方 agent preset 不在）。
- **子出口仍可单独装配**（`@morlay/dsh-context-assembler/assembler` 等）：同一些插件，只是默认走组装出口。

## 维护注意

- 测试落点在 `src/__tests__/<capability>/`（根 vitest 的 include 是 `packages/**/src/__tests__/**`，所以不能
  按能力就近放 `src/<capability>/__tests__/`）。
- 读上游文件的覆盖性测试用 `process.cwd()`（vitest 从仓库根跑），不要按文件深度算相对路径。
- 新增一个能力：加 `src/<capability>/`，再把它登记进 `src/index.ts` 的 `CAPABILITIES`（子出口与 tsdown 入口一起加）；装配面不动。
