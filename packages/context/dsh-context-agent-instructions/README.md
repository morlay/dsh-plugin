# @morlay/dsh-context-agent-instructions

把工作区指令链注入成规则块的 cordis 插件：`$DSH_HOME/AGENTS.md`，加上项目根到 cwd 的逐级
`AGENTS.md` / `AGENTS.local.md`，**一条文件一个 id**（`agent-instructions:<根标识>:<文件>`——根标识是
项目根 / `$DSH_HOME` 的 8 位摘要，所以同进程里两个项目根的同名文件不会互相顶掉），文件变化时只重发
变了的那一份。取代上游 `@deepseek-ai/dsh-agent-instructions`（host 那行由上游 web-app bundle 自己设在
preset 平面，本地发现归 preset，所以不再需要本仓库的 patch 去禁它）。

规则与 id 形态见[上下文注入规则](../.agents/designs/20260921-上下文注入规则.md)。

## 行为

| 环节     | 做什么                                                               |
| -------- | -------------------------------------------------------------------- |
| 会话创建 | 算出该会话的指令链（cwd → 项目根，由窄到宽再反转成宽泛到具体）       |
| 每步     | 按 `mtime:size` 对账；内容没变的文件不重读、不重发                   |
| 注入     | 每条文件一条规则块，正文就是文件内容（来源已由 id 表达，不再写前言） |

- **不跟踪 `read`/`write`/`edit`**：上游靠 touch 上浮触发刷新，是为频繁变动的指令文件设计的；本部署的
  `AGENTS.md` 几乎不变，按 `mtime`/`size` 对账足够。
- **超预算可见**：单文件超过 `maxBytes` 时截断并留一行提示，不静默丢内容。

### 与上游的 baseline 认领对齐

注入条目的 `source` 沿用上游那两样：`kind: "agent-instructions"`（客户端「上下文注入」标签与按 kind
认领的消费方才认得这是工作区指令）与 `baseline: true` + `baselineIdentity`（上游的认领判据是
「kind 相同 **且** baseline 为真 **且** 身份逐字相等」）。

少了后两样会出一个只在真会话里看得见的毛病：**同会话切到官方 preset 后出现两条 AGENTS.md**——上游那行
认为基线不存在，于是再注入一条自己的模板（"Use them as guidance…"，与我们的正文口径矛盾），而模型无法
把后一条理解成"作废前一条"（两条的幂等键不同）。身份算法复刻自上游的 `workspaceBaselineIdentity`（默认值
取自它导出的 `Config` schema，配置基线与 base bundle 那行的 `maxBytes: 65536` 同源），`baseline.spec.ts`
用上游源码出口的真函数比对，防这份复刻漂移。

## 配置

| 字段                             | 默认                   | 含义                           |
| -------------------------------- | ---------------------- | ------------------------------ |
| `instructionFileCandidates`      | `['AGENTS.md']`        | 每级目录的基础指令文件         |
| `localInstructionFileCandidates` | `['AGENTS.local.md']`  | 基础文件之后加载的本地 overlay |
| `maxBytes`                       | `65536`                | 单个指令文件的渲染上限         |
| `dshHome`                        | `$DSH_HOME` / `~/.dsh` | 用户全局指令所在目录           |

## 装配

[dsh-preset](../../preset/dsh-preset/cordis.patch.yml) 的 patch 里一行（host plane），与注入通道一起。
