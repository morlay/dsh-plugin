# DSH Plugin(s)

DeepSeek Harness Plugin 自用开发插件集合。
在不改变 `@deepseek-ai/*` 代码的前提下，进行自定义扩展。

## 项目

`bundles/` 是**装配入口**：一个 bundle 聚合一个领域——行清单与它要的配置值住在同一个包里，能力包只发布
实现与 `rows` 出口（不再自带 patch）。

| bundle                             | 装什么                                                                     |
| ---------------------------------- | -------------------------------------------------------------------------- |
| `bundles/better-session/`          | 会话面接管（会话编辑闭环 + 对话 UI + 引用展开 + 行配置页）                 |
| `bundles/session-mode-profile/`    | 会话模式 + 注入通道 + 工具说明（汉化）+ subagent 接管行                    |
| `bundles/sandbox-profile/`         | 沙箱替换行与访问规则的值                                                   |
| `bundles/ollama-provider-profile/` | `llm-pi-ai` 的 ollama provider + 搜索后端注册行 + `web` 行的 provider 选择 |
| `bundles/mydsh-profile/`           | 个人配置值（界面语言、欢迎提示、默认模型、对话视图）                       |

包按 `packages/<family>/<pkg>` 两层存放——family 是目录分组，**不等于**上下文分组（一个 family 的包
可以分属不同上下文）；上下文边界、术语表的 home 与归属见
[`.agents/CONTEXT-MAP.md`](.agents/CONTEXT-MAP.md)。

| 包                                         | 职责                                                                                                                                                           | 文档                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **session**（会话编辑）                    |                                                                                                                                                                |                                                                      |
| `bundles/better-session/`                  | 聚合层：profile bundle（安装 / 使用 / 配置）                                                                                                                   | [README](./packages/bundles/better-session/README.md)                |
| `session/session-branch/`                  | 契约层：分支 provider 抽象 + `SessionBranch` 服务                                                                                                              | [README](packages/session/session-branch/README.md)                  |
| `session/session-rdb/`                     | 实现层：RDB 持久化 + 分支 provider + storages / 查询接管                                                                                                       | [README](packages/session/session-rdb/README.md)                     |
| `session/ui-conversation-message-actions/` | 编排层：edit / retry / recall / fork 编排 + client UI 替换                                                                                                     | [README](packages/session/ui-conversation-message-actions/README.md) |
| `session/ui-conversation/`                 | 上游对话外壳的**薄壳 fork**（只留我们改过的文件，其余 import 指向上游源码、构建内联）                                                                          | [README](packages/session/ui-conversation/README.md)                 |
| `session/ui-conversation-manager/`         | 「对话管理」全局面板页：已归档会话的搜索 / 取消归档 / 删除 / 导入为新会话                                                                                      | [README](packages/session/ui-conversation-manager/README.md)         |
| **context**（上下文注入）                  |                                                                                                                                                                |                                                                      |
| `context/dsh-context-assembler/`           | 注入能力组（一个包四个出口）：通道 `assembler`、工作区指令 `agent-instructions`、skill 目录 `skill-catalog`、模式收口 `scope`（工具说明归 toolkit）            | [README](packages/context/dsh-context-assembler/README.md)           |
| `context/dsh-reference/`                   | 引用展开：`@path` / `skill:name` 在 `agent/pre-step` 注入内容（引用解析复用 `client/ui-primitives`、构建内联）                                                 | [README](packages/context/dsh-reference/README.md)                   |
| **client**（浏览器半基础）                 |                                                                                                                                                                |                                                                      |
| `client/ui-primitives/`                    | 各行 `Config` 的 volatile schema → 该行的配置页（覆盖 schemastery 全部类型）+ 字段级自定义输入槽                                                               | [README](packages/client/ui-primitives/README.md)                    |
| `client/ui-primitives/`                    | CSS-in-JS 样式层 + 引用统一解析 / 渲染转换                                                                                                                     | [README](packages/client/ui-primitives/README.md)                    |
| **llm**（LLM 适配）                        |                                                                                                                                                                |                                                                      |
| `llm/llm-openai-compatible/`               | OpenAI-compatible 多 provider 路由（可选组件）                                                                                                                 | [README](packages/llm/llm-openai-compatible/README.md)               |
| **web**（联网后端）                        |                                                                                                                                                                |                                                                      |
| `web/dsh-web-search-ollama/`               | `ctx.web` 的搜索后端：`web_search` 走 Ollama `/api/web_search`                                                                                                 | [README](packages/web/dsh-web-search-ollama/README.md)               |
| **profile**（profile 组成）                |                                                                                                                                                                |                                                                      |
| `profile/dsh-profile/`                     | profile 的配置初始化层：按 id 配值，或按 id 关掉部署不要的行，一行都不插                                                                                       | [README](./packages/bundles/mydsh-profile/README.md)                 |
| `profile/dsh-session-mode/`                | 两个模式作为**官方 agent preset 的会话级扩展**：`preset`（挂哪套行）+ persona、能力开关、角色与可选默认模型，按会话应用；子代理继承父模式；选择面归官方 roster | [README](packages/profile/dsh-session-mode/README.md)                |
| `profile/dsh-agent-toolkit/`               | 工具说明（族索引的汉化精简、用法分组）与工具名数据（模式白名单从它派生）+ Agent Teams 可选子出口；工具行由官方 preset 提供                                     | [README](packages/profile/dsh-agent-toolkit/README.md)               |
| **subagent**（子代理服务接管）             |                                                                                                                                                                |                                                                      |
| `subagent/dsh-subagent/`                   | 上游 `ctx.subagents` 服务的**薄壳 fork**：只把 continuable 子代理的回报指引换成中文，其余走上游源码（构建内联）                                                | [README](packages/subagent/dsh-subagent/README.md)                   |
| **sandbox**（沙箱替换）                    |                                                                                                                                                                |                                                                      |
| `sandbox/dsh-sandbox-local/`               | 额外可写根 + 拒绝项（替换 `ctx.sandbox` / `ctx.fs`）                                                                                                           | [README](packages/sandbox/dsh-sandbox-local/README.md)               |
| **desktop**（桌面化）                      |                                                                                                                                                                |                                                                      |
| `desktop/dsh-desktopify/`                  | 桌面化打包工具（`dsh-desktopify` CLI：dev / bundle；壳本身在 `desktop/dsh-desktop-shell/`）                                                                    | [README](packages/desktop/dsh-desktopify/README.md)                  |
| `desktop/dsh-desktop-shell/`               | 桌面应用的 Electron 壳（主进程 + preload：应用协议、字节管道起 host、首启种 profile）；工具与它按子出口共享种子 / 官方包 / home 这几份事实                     | [README](packages/desktop/dsh-desktop-shell/README.md)               |
| `desktop/dsh-desktop-host/`                | 桌面部署的 host 进程（上游 host 的变体：`desktop` profile、URL / IPC 上报给壳，不挂 office 技能）                                                              | [README](packages/desktop/dsh-desktop-host/README.md)                |
| **workspace**（非发布）                    |                                                                                                                                                                |                                                                      |
| `apps/dsh-custom-next/`                    | 示例工作区：web 模式（`dsh web`）与 desktop 模式（Electron 壳）                                                                                                | [justfile](apps/dsh-custom-next/justfile)                            |
| `devpackages/devkit/`                      | 共享开发配置 `@local/devkit`（本地私有包，不发布）：cordis 插件 tsdown 预设 + tsconfig（`packages/*/*` 复用）                                                  | [tsconfig](devpackages/devkit/tsconfig.json)                         |
| `vendor/`                                  | 上游 deepseek-harness side workspace（同步 / 裁剪 / 构建）                                                                                                     | [skill](.agents/skills/dsh-plugin-upstream-sync/SKILL.md)            |

## 文档

| 目录                                                                   | 内容                                         |
| ---------------------------------------------------------------------- | -------------------------------------------- |
| [`.agents/`](.agents)                                                  | 记录树（布局 / 词汇 / 边界）                 |
| [`.agents/standards/`](.agents/standards)                              | 规范（如何写 / 如何验证）                    |
| [`.agents/designs/`](.agents/designs)                                  | 整体设计（布局 / 装配）                      |
| [`.agents/adrs/`](.agents/adrs) · [`.agents/debts/`](.agents/debts)    | 仓库级决策 · 技术债                          |
| [`.agents/skills/`](.agents/skills)                                    | 流程（设计 / 实现 / 审查 / 改进 / 上游同步） |
| [AGENTS.md](AGENTS.md) · [justfile](justfile) · [mise.toml](mise.toml) | agent 工作指引 · 命令 · 技术栈与上游版本     |
