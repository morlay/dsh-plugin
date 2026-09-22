# @morlay/dsh-context-scope

把某个 preset 的工具目录收成白名单：对它装载到的 agent 挂一层执行 guard（调用白名单外的工具时
给模型一句可读提示），并在装配期把模型看到的工具目录投影成同一份白名单——两侧同判据，白名单外的
工具既不进目录、也调用不了。

## 为什么

preset composition 只能决定"加什么"，管不了 host 层——`dsh.profile.bundles` 打开一个 bundle
（例如实验性的 Agent Teams）会在 host 层插工具行，对所有 preset 一视同仁。模式要表达"我只有这几个工具"
时，唯一与来源无关的做法是在会话语义上收口：说清"有什么"，而不是逐个去堵"不要什么"。

## 配置

| 字段             | 默认   | 含义                                                                                                                                                                                                                               |
| ---------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `allowTools`     | —      | 只保留这些工具；为空时装配直接失败（该省掉整行，而不是挂一个空作用域）                                                                                                                                                             |
| `instructions`   | `true` | 关掉这个会话的 instruction 类注入（工作区指令 / 技能目录 / 降级 section 那类**规则块**）。内容块（`auto` 组正文、引用材料）不受它管——要连那些也没有，得让对应注入方别注册（`chat` 同时给了 `groups: false`）。与工具白名单是两件事 |
| `runtimeContext` | `true` | 是否要动态快照（文件沙箱策略、审批策略那两条 context）。`false` 表示这个模式不要它们：对话模式没有文件与 shell 工具，"能改工作区哪些文件、要不要走审批"全是噪音                                                                     |

`runtimeContext: false` 走的是上游 `systemPrompt.suppressRuntimeContext()`：**按 scope** 抑制（上游按装配的
scope 链查抑制器），所以本行装在 preset 子树里就只作用于这个模式的会话，官方 preset 与 coding 照旧收到那两条。
它只挡注入，不改任何提供方的行为——沙箱该怎么判还怎么判。

## 边界

- **不走上游 `tools.restrict()`**：它会改动可见工具集、从而触发 `tools/change`，而上游
  `tool-subagent` 正用该事件做 composition reconcile——两边互相触发会变成装配风暴。这里用投影过滤
  加执行层 guard：既不碰注册表、也不发事件。
- **两处落点**：目录过滤在 `system-prompt/assemble`（每步幂等，只改本次装配结果）；guard 在**装配期**
  注册到 `agent.ctx`（创建期注册的可用性还在变，容易与装配流程互相牵扯）。
- **抑制清的是"全部动态 context"**（上游语义），不只是沙箱与审批那两条：本行只该装在"一条动态快照都不要"
  的模式上。
- 白名单只管工具：文件系统与进程的收口在 `sandbox/dsh-sandbox-local`。

## 装配

写在 preset 产物里（按模式给），例如 `chat` 产物末尾一行：

```yaml
- id: context-scope
  name: "@morlay/dsh-context-scope"
  config:
    allowTools: [ask_user_question, web_search, web_fetch]
    instructions: false
    runtimeContext: false
```
