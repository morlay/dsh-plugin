# @morlay/dsh-context

提示词注入能力组：**一个包，每个能力一个子出口**。装配行写 `@morlay/dsh-context/<capability>`，行 id 是
`context-<capability>`（包名与行 id 由同一个「前缀 + 能力名」派生，见
[`rows.ts` 的 `context()`](../../preset/dsh-agent-preset/tool/presets/rows.ts)）。

| 出口                   | 行 id                        | 做什么                                                            |
| ---------------------- | ---------------------------- | ----------------------------------------------------------------- |
| `./assembler`          | `context-assembler`          | 注入通道：唯一渲染者与唯一覆盖判定处，发布 `ctx.contextAssembler` |
| `./agent-instructions` | `context-agent-instructions` | 工作区指令链（`$DSH_HOME/AGENTS.md` + 项目根到 cwd 逐级）         |
| `./skill-catalog`      | `context-skill-catalog`      | skill 目录规则块 + 模型侧 `skill` 工具                            |
| `./reference`          | `context-reference`          | 用户消息里的 `@path` / `skill:name` 引用展开                      |
| `./tool-guidance`      | `context-tool-guidance`      | 工具用法按组切分、短描述投影、上游说明丢弃                        |
| `./scope`              | `context-scope`              | 模式收口：工具白名单、instruction 总开关、动态快照开关            |

规则、id 表与分层的 home 在 [上下文注入规则](./.agents/designs/20260921-上下文注入规则.md)；术语见
[本包 CONTEXT](./.agents/CONTEXT.md)。

## 为什么合成一个包

这 6 个能力**总是一起装配**（同一个 `isolate` 组：通道与它的消费者必须同子树），5 个注入方**全都只用通道的
类型与服务面**，`reference` 与 `agent-instructions` 还各写了一份「读文件 + 字节预算」。包边界在这里只是
演进留下的：合成一个包之后，加一个能力 = 加一个子出口 + 装配面一行。

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

配置（`keep` / `suppress` / `replace`）的默认值在 [`src/assembler/defaults.ts`](./src/assembler/defaults.ts)。
**按模式各一份**：它发布进程全局服务，只有关在 `isolate` 组里才装得进 preset，也才不会把我们的注入漏给别的
preset（见 [ADR](../../preset/dsh-agent-preset/.agents/adrs/20260922-通道与注入行按模式isolate装配.md)）。

## agent-instructions

`$DSH_HOME/AGENTS.md` 加项目根到 cwd 的逐级 `AGENTS.md` / `AGENTS.local.md`，**一条文件一条 id**
（`agent-instructions:<根标识>:<文件>`，根标识是根目录的 8 位摘要——同进程两个项目根的同名文件因此不会互相
顶掉），文件变化时只重发变了的那一份。取代上游 `@deepseek-ai/dsh-agent-instructions`（host 那行由上游
web-app bundle 自己设在 preset 平面）。

- **不跟踪 `read`/`write`/`edit`**：上游靠 touch 上浮触发刷新；本部署的 `AGENTS.md` 几乎不变，按
  `mtime:size` 对账足够。
- **超预算可见**：单文件超过 `maxBytes` 时截断并留一行提示，不静默丢内容。
- **与上游的 baseline 认领对齐**：`source` 带 `kind: "agent-instructions"` + `baseline: true` +
  `baselineIdentity`（身份与上游 `workspaceBaselineIdentity` 逐字相等）。少了后两样会出一个只在真会话里
  看得见的毛病：**同会话切到官方 preset 后出现两条 AGENTS.md**——上游认为基线不存在，再注入一条自己的模板
  （"Use them as guidance…"），两条口径矛盾且模型无法理解为覆盖。
- 配置：`instructionFileCandidates` / `localInstructionFileCandidates`（覆盖成只读 `AGENTS*`，不含 CLAUDE
  系列）、`maxBytes`（65536）、`dshHome`。

## skill-catalog

`skill-catalog` 规则块（`<available_skills>`，一行 `名字: 摘要`，只列模型可调用的 skill）加模型侧 `skill`
工具。取代上游 `@deepseek-ai/dsh-tool-skill`（`skill-filesystem` 保留——它提供 skill 发现）。目录变更走
同 id 覆盖；`auto` 的 skill 不进目录（正文已随提示送达）。

## reference

把用户消息里的引用在 `agent/pre-step` 边界展开成注入消息：skill 引用渲染 `<skill_content>`，`@path` 读取
内容并渲染成 `<file_content path="…">` 内容块。只扫描本步 claimed 的 `source.kind === 'user'` 消息，
解析与 client 面同源（`@morlay/dsh-client-ui-primitives` 的 `findReferences`）。只认 `@` 起手这一形态；
文件经 `ctx.fs` 读取（读不出就保持普通文本）；本步所有文件合成一条注入消息、每个文件一个内容块，
去重按「路径 + 行窗口」。不写 `source.kind === 'user'` 的手势伪造不了。

## tool-guidance

**工具不设门控**：全部工具始终可见可调用；组只决定用法说明怎么分批送达——`base` 组正文常驻，`flow` /
`delegation` / `team` 注册成按需加载的 skill。三件事：登记组 skill；用一行中文短描述覆盖模型看到的工具
`description`（改装配投影而不写注册表——后者会触发 `tools/change`，与上游 `tool-subagent` 的 composition
reconcile 互相激成装配风暴）；丢弃上游工具说明与规则 section（`drops`，要点已写进各组的正文列表）。

组的唯一 home 是 [`src/tool-guidance/groups.ts`](./src/tool-guidance/groups.ts)：工具名、摘要与正文、注入
方式、丢弃清单、短描述都在那一份；覆盖性测试保证 standard 装配的每个工具与每个 section 都有归属。
Config 只有一个开关 `groups`（默认 `true`；chat 给 `false`）。

## scope

预设模式的收口行：工具白名单（装配期投影 + 执行层 guard，两侧同判据）、`instructions`（关掉规则块与降级
section）、`runtimeContext`（关掉沙箱 / 审批那两条动态快照，按 scope 抑制）。它解决的是"preset 只能决定加
什么、管不了 host 层"——模式要表达"我只有这几个工具、一条提示词都不要"时，唯一与来源无关的做法是在会话
语义上收口。`allowTools` 为空即装配失败（该省掉整行）。

## 装配

preset 的通道组里逐行引用（`coding` 装 5 个、`chat` 装 3 个）：

```yaml
- id: context-channel
  name: cordis:group
  group: true
  isolate:
    contextAssembler: true
  config:
    - id: context-assembler
      name: "@morlay/dsh-context/assembler"
    - id: context-agent-instructions
      name: "@morlay/dsh-context/agent-instructions"
    # …
```

**通道与它的全部消费者必须在同一个组里**：`isolate` 是"该名字只在这棵子树内解析成独立 label"，落一个消费
者在组外，它的 `inject` 会永远等不到服务（行停在 waiting，不报错）。`patch.spec.ts` 把这条钉住。

## 维护注意

- 测试落点在 `src/__tests__/<capability>/`（根 vitest 的 include 是 `packages/**/src/__tests__/**`，所以不能
  按能力就近放 `src/<capability>/__tests__/`）。
- 读上游文件的覆盖性测试用 `process.cwd()`（vitest 从仓库根跑），不要按文件深度算相对路径。
- 新增一个能力：加 `src/<capability>/`、`package.json` 与 `tsdown.config.ts` 的出口、装配面的 `context()` 一行。
