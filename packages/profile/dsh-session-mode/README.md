# @morlay/dsh-session-mode

**模式 = agent preset 的会话级扩展**：每个模式声明它挂在哪份 preset 上（`preset`，行清单由那份 preset 提供），
再给这个会话加四样东西——一段 persona、一组工具白名单（收口）、instruction / 动态快照开关、可选默认模型。
模式清单与默认值就是本行的 `config.modes`：真源在 [`src/mode-sources.ts`](./src/mode-sources.ts)，行 config 由
[`src/rows.ts`](./src/rows.ts) 渲染；**模式不是 Cordis 子树**，选择落成会话事实（`session-mode/selected` 事件 +
`sessionMode` 投影）。会话里选模式走本包 client 半的 chip 与 `GET/POST /session-mode`，且只在**空白会话**成立。

本包不装配任何行：装配入口在 [`@morlay/session-mode-profile`](../../bundles/session-mode-profile/README.md)
（它插 preset 声明、`session-mode`、`context-assembler-scope`，外加通道、工具说明与 subagent 那几行）。

## 用法

自定义就是改这份 config——profile 的用户 patch 层可以整体改写 `config.modes`，也可以只给某个模式换提示词、
白名单或它挂的 preset，不需要任何插件行：

```yaml
- id: session-mode
  name: "@morlay/dsh-session-mode"
  config:
    default: coding # 新会话的起始模式：必须在 modes 里且是 main 角色
    modes:
      chat:
        preset: mode-switch # 挂哪份 preset；行清单由它提供，几个模式可以共享
        name: 对话模式
        description: 只做对话：提问与联网（搜索、抓取）三件工具。
        role: [main] # main = 用户选择器；subagent = 可作子代理 mode 的候选
        persona:
          prefix: 你是一个助手。……
        allowTools: [ask_user_question, web_search, web_fetch]
        instructions: false # instruction 类注入（工作区指令、技能目录、用法正文）
        runtimeContext: false # 动态快照（沙箱策略、审批策略）
        defaultModel: { provider: ollama, model: deepseek-v4.1-flash, reasoningEffort: high }
```

写错在装载时就拒绝：`default` 必须在清单里且声明 `main`、每个模式至少给一个工具、`role` 不能是空数组、
`defaultModel` 要给全 `provider` 与 `model`。改动等 Loader 重挂这一行生效，已运行会话不自动换定义。
