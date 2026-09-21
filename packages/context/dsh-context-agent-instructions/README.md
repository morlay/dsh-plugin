# @morlay/dsh-context-agent-instructions

把工作区指令链注入成规则块的 cordis 插件：`$DSH_HOME/AGENTS.md`，加上项目根到 cwd 的逐级
`AGENTS.md` / `AGENTS.local.md`，**一条文件一个 id**（`agent-instructions:<文件>`），文件变化时只重发
变了的那一份。取代上游 `@deepseek-ai/dsh-agent-instructions`（该行在 preset 产物里已禁用）。

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

## 配置

| 字段                             | 默认                   | 含义                           |
| -------------------------------- | ---------------------- | ------------------------------ |
| `instructionFileCandidates`      | `['AGENTS.md']`        | 每级目录的基础指令文件         |
| `localInstructionFileCandidates` | `['AGENTS.local.md']`  | 基础文件之后加载的本地 overlay |
| `maxBytes`                       | `65536`                | 单个指令文件的渲染上限         |
| `dshHome`                        | `$DSH_HOME` / `~/.dsh` | 用户全局指令所在目录           |

## 装配

[dsh-preset](../../preset/dsh-preset/cordis.patch.yml) 的 patch 里一行（host plane），与注入通道一起。
