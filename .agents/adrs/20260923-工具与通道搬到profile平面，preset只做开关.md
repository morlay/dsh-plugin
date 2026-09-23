# 工具与通道搬到 profile 平面，preset 只做开关

状态：已采纳（取代 [ADR-20260922-通道与注入行按模式isolate装配](../../packages/profile/dsh-session-mode/.agents/adrs/20260922-通道与注入行按模式isolate装配.md) 的装配平面部分）（其中「preset 只剩提示词与开关」这半自 2026-09-24 起被
[ADR 模式不再是 Cordis 子树](../../packages/profile/dsh-session-mode/.agents/adrs/20260924-模式不再是cordis子树.md) 取代：
模式不再是 Cordis 子树，也不再走官方 agent preset；下面「preset 只剩…」读作「模式只剩…」）

背景：`@morlay/dsh-agent-preset` 的两个模式原先**内联展开**工具行（`...TOOLKIT_ROWS`）并把注入通道关进各自的
`isolate` 组——同一份工具清单在 toolkit 与 preset 两处装配，通道与注入方（含工具说明）也每个模式各一份。
"preset 只做开关"这条边界因此没落地；顺带暴露一个既有缺陷：coding 不带 config 时 `scope` 收到空的
`allowTools`，而它对空名单是 fail loud，错误吞在子 fiber 里没人看见。

**决定**

三件事：

1. **工具行在 profile 平面装一次**：`dsh.profile.bundles` 列出
   [`@morlay/dsh-agent-toolkit`](../../packages/profile/dsh-agent-toolkit/README.md)（工具行 + 它们各自的 config
   全局一份，含默认关闭的 Agent Teams 组）。
2. **通道与它的注入方也在 profile 平面装一次**：同一列表里列出
   [`@morlay/dsh-context-assembler`](../../packages/context/dsh-context-assembler/README.md)（它的 bundle patch
   装通道 + `agent-instructions` + `skill-catalog`；**`scope` 不在那里**——它是模式的开关）。工具说明的运行时
   （描述汉化 + schema 精简 + 用法分组）作为 toolkit bundle 的一行同层装载。
3. **preset 只剩提示词与开关**：`persona`、`relax-intent`（模式取舍）、`context-scope`（`allowTools` 白名单 +
   `instructions` / `runtimeContext` 总开关）。白名单从 toolkit 的汉化数据派生（`TOOLKIT_TOOL_NAMES`，
   工具集与说明同源）。

**收口方式随之改变**：不再靠"通道住 preset 的 isolate realm"，而是靠 `scope` 出口按 agent 做的三件事——
装配期投影工具目录、执行层 guard、`setInstructions` / `suppressRuntimeContext`——它对所有 agent 生效，与工具行
住在哪一层无关。

## 考虑过的选项

- **维持内联展开**：同一份清单两处装配（toolkit 的 bundle patch 与 preset 的 plugins），加一个工具要动两处；
  "preset 只做开关"落不了地。
- **只搬工具行、通道仍按模式 isolate**：工具说明的运行时拿不到通道（通道在 preset 子树里），于是它只能继续
  按模式各装一份——与"profile 平面一次"冲突。
- **通道搬全局但保留 `isolate` 组**：通道落在一个隔离 realm，profile 平面的注入方解析不到它；`scope` 的
  `setInstructions` 也够不着。

## 后果

- **官方四个 preset 已关闭**（[ADR-profile 层三分](../../.agents/adrs/20260923-profile层三分（配置初始化与提示词开关与能力清单）.md)），
  所以"通道住 host 平面会把注入漏给官方 preset"这个前提不再成立——这正是这次能搬的前提。
- 工具行的 config（`fs-search.sampleOverCapGlobResults`、`subagent` 的 provider 等）现在是全局一份；模式的工具集
  完全由 `allowTools` 决定（不存在的工具写进白名单无害）。
- 两个模式共享同一套通道注册表：`chat` 靠 `allowTools` 三件 + `instructions: false` + `runtimeContext: false`
  收口（它不再有 `groups: false` 这条——组正文按会话可见工具过滤，且它的 skill 目录被 instruction 开关关掉）。
- `dsh.profile.bundles` 变成七个：`better-session` → `context-assembler` → `agent-toolkit` → `sandbox-local` →
  `web-search-ollama` → `dsh-profile` → `session-mode`（能力在前、配置与模式在后）。
- 老部署里若按 id 覆盖过通道组（`context-assembler-channel`）或模式内的工具行，需要跟着清掉：那些行现在由
  bundle 提供，模式里已不存在。
