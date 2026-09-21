# @morlay/dsh-context-scope

把某个 preset 的工具目录收成白名单：对它装载到的 agent 调 `agent.ctx.tools.restrict({ allow })`，
于是模型看到的工具与可调用的工具都只剩白名单里那几个。

## 为什么

preset composition 只能决定"加什么"，管不了 host 层——`dsh.profile.bundles` 打开一个 bundle
（例如实验性的 Agent Teams）会在 host 层插工具行，对所有 preset 一视同仁。模式要表达"我只有这几个工具"
时，唯一与来源无关的做法是在会话语义上收口：说清"有什么"，而不是逐个去堵"不要什么"。

## 配置

| 字段    | 默认 | 含义                                                                   |
| ------- | ---- | ---------------------------------------------------------------------- |
| `allow` | —    | 只保留这些工具；为空时装配直接失败（该省掉整行，而不是挂一个空作用域） |

## 边界（上游 `tools.restrict` 的语义）

- 过滤的是**继承面**（global + 祖先 scope），所以本插件在 **agent 作用域**调用它；在同层调用会把自己的
  preset 行也算成 own 层，`restrict` 会以 "unknown global tool" 拒绝。
- **注册在 agent 自己作用域的工具不受过滤**（上游刻意的机制豁免）：白名单不是沙箱，它收不了那种注册方式。
  上游 `tool-subagent` 的 `modelSelectionSettings` 就是这样注册的——本部署已把它去掉（子代理继承父会话模型），
  所以当前没有这类工具。

## 装配

写在 preset 产物里（按模式给），例如 `chat` 产物末尾一行：

```yaml
- id: context-scope
  name: "@morlay/dsh-context-scope"
  config:
    allow: [ask_user_question, web_search, web_fetch]
```
