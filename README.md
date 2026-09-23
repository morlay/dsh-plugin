# DSH Plugin(s)

DeepSeek Harness Plugin 自用开发插件集合。
在不改变 `@deepseek-ai/*` 代码的前提下，进行自定义扩展。

## 项目

包按 `packages/<family>/<pkg>` 两层存放——family 是目录分组，**不等于**上下文分组（一个 family 的包
可以分属不同上下文）；上下文边界、术语表的 home 与归属见
[`.agents/CONTEXT-MAP.md`](.agents/CONTEXT-MAP.md)。

| 包                                         | 职责                                                                                                                                                | 文档                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **session**（会话编辑）                    |                                                                                                                                                     |                                                                      |
| `session/better-session/`                  | 聚合层：profile bundle（安装 / 使用 / 配置）                                                                                                        | [README](packages/session/better-session/README.md)                  |
| `session/session-branch/`                  | 契约层：分支 provider 抽象 + `SessionBranch` 服务                                                                                                   | [README](packages/session/session-branch/README.md)                  |
| `session/session-rdb/`                     | 实现层：RDB 持久化 + 分支 provider + storages / 查询接管                                                                                            | [README](packages/session/session-rdb/README.md)                     |
| `session/ui-conversation-message-actions/` | 编排层：edit / retry / recall / fork 编排 + client UI 替换                                                                                          | [README](packages/session/ui-conversation-message-actions/README.md) |
| `session/ui-conversation/`                 | 上游对话外壳的**薄壳 fork**（只留我们改过的文件，其余 import 指向上游源码、构建内联）                                                               | [README](packages/session/ui-conversation/README.md)                 |
| `session/ui-conversation-manager/`         | 「对话管理」全局面板页：已归档会话的搜索 / 取消归档 / 删除 / 导入为新会话                                                                           | [README](packages/session/ui-conversation-manager/README.md)         |
| **context**（上下文注入）                  |                                                                                                                                                     |                                                                      |
| `context/dsh-context-assembler/`           | 注入能力组（一个包四个出口）：通道 `assembler`、工作区指令 `agent-instructions`、skill 目录 `skill-catalog`、模式收口 `scope`（工具说明归 toolkit） | [README](packages/context/dsh-context-assembler/README.md)           |
| `context/dsh-reference/`                   | 引用展开：`@path` / `skill:name` 在 `agent/pre-step` 注入内容（引用解析复用 `client/ui-primitives`、构建内联）                                      | [README](packages/context/dsh-reference/README.md)                   |
| **client**（浏览器半基础）                 |                                                                                                                                                     |                                                                      |
| `client/ui-primitives/`                    | CSS-in-JS 样式层 + 引用统一解析 / 渲染转换                                                                                                          | [README](packages/client/ui-primitives/README.md)                    |
| **llm**（LLM 适配）                        |                                                                                                                                                     |                                                                      |
| `llm/llm-openai-compatible/`               | OpenAI-compatible 多 provider 路由（可选组件）                                                                                                      | [README](packages/llm/llm-openai-compatible/README.md)               |
| **web**（联网后端）                        |                                                                                                                                                     |                                                                      |
| `web/dsh-web-search-ollama/`               | `ctx.web` 的搜索后端：`web_search` 走 Ollama `/api/web_search`                                                                                      | [README](packages/web/dsh-web-search-ollama/README.md)               |
| **profile**（profile 组成）                |                                                                                                                                                     |                                                                      |
| `profile/dsh-profile/`                     | profile 的配置初始化层：按 id 配值，或按 id 关掉部署不要的行，一行都不插                                                                            | [README](packages/profile/dsh-profile/README.md)                     |
| `profile/dsh-session-mode/`                | 两个会话模式（`coding` / `chat`）作为数据：persona 加能力开关，按会话应用；官方 agent preset 那一套在本部署被禁用                                   | [README](packages/profile/dsh-session-mode/README.md)                |
| `profile/dsh-agent-toolkit/`               | agent 的工具清单与工具说明（族索引的汉化精简、用法分组）+ Agent Teams 可选子出口：模式从它派生白名单，profile 直接装配                              | [README](packages/profile/dsh-agent-toolkit/README.md)               |
| **sandbox**（沙箱替换）                    |                                                                                                                                                     |                                                                      |
| `sandbox/dsh-sandbox-local/`               | 额外可写根 + 拒绝项（替换 `ctx.sandbox` / `ctx.fs`）                                                                                                | [README](packages/sandbox/dsh-sandbox-local/README.md)               |
| **desktop**（桌面化）                      |                                                                                                                                                     |                                                                      |
| `desktop/dsh-desktopify/`                  | 桌面化打包工具（`dsh-desktopify` CLI：dev / bundle）                                                                                                | [README](packages/desktop/dsh-desktopify/README.md)                  |
| `desktop/dsh-desktop-host/`                | 桌面部署的 host 进程（上游 host 的变体：`desktop` profile、URL / IPC 上报给壳，不挂 office 技能）                                                   | [README](packages/desktop/dsh-desktop-host/README.md)                |
| **workspace**（非发布）                    |                                                                                                                                                     |                                                                      |
| `apps/dsh-custom-next/`                    | 示例工作区：web 模式（`dsh web`）与 desktop 模式（Electron 壳）                                                                                     | [justfile](apps/dsh-custom-next/justfile)                            |
| `devpackages/devkit/`                      | 共享开发配置 `@local/devkit`（本地私有包，不发布）：cordis 插件 tsdown 预设 + tsconfig（`packages/*/*` 复用）                                       | [tsconfig](devpackages/devkit/tsconfig.json)                         |
| `vendor/`                                  | 上游 deepseek-harness side workspace（同步 / 裁剪 / 构建）                                                                                          | [skill](.agents/skills/dsh-plugin-upstream-sync/SKILL.md)            |

## 文档

| 目录                                                                   | 内容                                         |
| ---------------------------------------------------------------------- | -------------------------------------------- |
| [`.agents/`](.agents)                                                  | 记录树（布局 / 词汇 / 边界）                 |
| [`.agents/standards/`](.agents/standards)                              | 规范（如何写 / 如何验证）                    |
| [`.agents/designs/`](.agents/designs)                                  | 整体设计                                     |
| [`.agents/adrs/`](.agents/adrs) · [`.agents/debts/`](.agents/debts)    | 仓库级决策 · 技术债                          |
| [`.agents/skills/`](.agents/skills)                                    | 流程（设计 / 实现 / 审查 / 改进 / 上游同步） |
| [AGENTS.md](AGENTS.md) · [justfile](justfile) · [mise.toml](mise.toml) | agent 工作指引 · 命令 · 技术栈与上游版本     |
