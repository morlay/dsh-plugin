# 上下文地图

术语的唯一 home 是**它被理解的那一层**的 `.agents/CONTEXT.md`；这张表划边界，并在出现新语言边界时登记。

| 上下文                       | 术语表                                                                                                                                       | 边界                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 会话编辑（跨包）             | [`.agents/CONTEXT.md`](./CONTEXT.md)                                                                                                         | 为会话提供就地编辑 / 重试 / 撤回 / 分支（rewind / retry / recall / fork）闭环的共用词汇；契约层 `session/session-branch`、编排层 `session/ui-conversation-message-actions`、实现层 `session/session-rdb`、聚合层 `session/better-session`                                                                                                                                                                                                                                                                                                                                                                                       |
| LLM 适配                     | [`packages/llm/llm-openai-compatible/.agents/CONTEXT.md`](../packages/llm/llm-openai-compatible/.agents/CONTEXT.md)                          | 为 OpenAI 兼容端点提供 LLM 适配器，只服务该包：`llm/llm-openai-compatible`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 对话 UI 接管（技术债）       | —（无独立词汇）                                                                                                                              | 上游对话外壳的**薄壳 fork**（只留我们改过的文件，其余 import 指向上游源码）与其服务包：`session/ui-conversation`（薄壳 fork 包）、`client/ui-primitives`（CSS-in-JS 样式层 + 引用统一解析 / 渲染转换）、`context/dsh-reference`（引用展开后注入，原在 assembler 包内）；`session/ui-conversation-message-actions` 的 client 半在这一层之上替换 `conversation.chat.node` 的 `user` / `steering` 渲染、并覆盖 `conversation.composer.dock` 的 `stats` 行；动机、差异登记与回退条件见[债务 临时接管上游对话UI的client半](../packages/session/ui-conversation/.agents/debts/20260917-临时接管上游对话UI的client半.md)      |
| profile 组成                 | —（无独立词汇）                                                                                                                              | 三个包各管一件事：`profile/dsh-profile`（配置初始化——只做 config 覆盖，不插行不禁行）、`profile/dsh-agent-preset`（两个模式的定义：只留 persona 与能力开关，各模式一行 `@deepseek-ai/dsh-agent-preset`）、`profile/dsh-agent-toolkit`（功能行清单，preset 引用它）；分工与双形态约定见 [ADR profile 层三分](./adrs/20260923-profile层三分（配置初始化与提示词开关与能力清单）.md)                                                                                                                                                                                                                                                                                                                                                              |
| 上下文注入                   | [注入能力组](../packages/context/dsh-context-assembler/.agents/CONTEXT.md)、[引用展开](../packages/context/dsh-reference/.agents/CONTEXT.md) | 给模型的注入形态与规则（规则块 / 内容块、id、同 id 覆盖、常驻与按需分层、回收）：`context/dsh-context-assembler` 一个包四个出口——`assembler`（唯一渲染者）、`agent-instructions`（工作区指令）、`skill-catalog`（skill 目录与 `skill` 工具）、`scope`（工具白名单与模式收口：目录与调用一起收口，可按模式关掉 instruction 与动态快照）；工具用法分组（`guidance`）归 `profile/dsh-agent-toolkit`；`context/dsh-reference` 独立成包——引用展开（`agent/pre-step`）不依赖通道服务，装在同一 profile 的 `@morlay/better-session` patch 里；规则见[设计 上下文注入规则](../packages/context/dsh-context-assembler/.agents/designs/20260921-上下文注入规则.md) |
| 对话管理（归档集操作面）     | —（无独立词汇）                                                                                                                              | `session/ui-conversation-manager`：「对话管理」全局面板页（搜索 / 取消归档 / 删除 / 导入为新会话），动作经上游 `uiWorkspace` 与 `session-rdb` 的 `session.delete` / `session.import` 路由；设置里那份「已归档会话」入口在上游 0.1.7 已随包删除（归档行改由侧边栏视图过滤承载），管理动作仍按 [ADR-禁用上游已归档入口改由对话管理页承载](../packages/session/better-session/.agents/adrs/20260918-禁用上游已归档入口改由对话管理页承载.md) 收敛到这一页                                                                                                                                                                          |
| 可配置沙箱                   | —（无独立词汇）                                                                                                                              | `sandbox/dsh-sandbox-local`：替换 `ctx.sandbox` / `ctx.fs`，在官方语义之上追加额外可写根与拒绝项                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| web 搜索后端                 | —（无独立词汇）                                                                                                                              | `web/dsh-web-search-ollama`：往 `ctx.web` 注册一个搜索后端（模型侧的 `web_search` 走 Ollama `/api/web_search`）；装配行与图片上限归 `profile/dsh-profile`                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 桌面化（工具，非插件上下文） | —（无独立词汇）                                                                                                                              | `desktop/dsh-desktopify`：把任意工作区打包 / 运行为桌面应用（Electron 壳）；`desktop/dsh-desktop-host`：桌面部署的 host 进程（上游 host 的变体：无端口传输、不带 office 技能）。决策见 [ADR-20260917-自研离线桌面打包器而非直接用上游桌面应用](./adrs/20260917-自研离线桌面打包器而非直接用上游桌面应用.md)                                                                                                                                                                                                                                                                                                                     |

## 规则

- **词只定义一次**：两个以上包要用的词 → 根 `.agents/CONTEXT.md`；只在一个上下文里有意义的词 → 那个包
  `.agents/CONTEXT.md`。别处要用就链接过去，不复制定义、不换说法。
- `CONTEXT.md` **只放术语**：不放规范、不放设计理由、不放实现说明（各自的 home 见仓库根
  [`AGENTS.md`](../AGENTS.md) 的 home 表）。
- 出现新的语言边界（某个包开始有一套自己的词）就在表里加一行，并在那个包的 `.agents/` 下立
  `CONTEXT.md`；只有实现、没有自己语言的包不立。

## 关系

- **工具说明 → 上下文注入**：`profile/dsh-agent-toolkit` 的 `guidance` 出口 只提供工具数据与分组内容，注入经
  `ctx.contextAssembler` 由 `context/dsh-context-assembler` 的 `assembler` 出口 送达（单向：通道不引用注入方）。决策见
  [ADR-提示词注入只有一个通道且按需内容走skill](../packages/context/dsh-context-assembler/.agents/adrs/20260921-提示词注入只有一个通道且按需内容走skill.md)。
- **会话编辑 ↔ LLM 适配**：无依赖。两者都作为 cordis 插件装配进 DeepSeek Harness，但互不引用（会话编辑经
  `agents` 服务 duck-typed 驱动重放，不经过 LLM 适配器）。
- **可配置沙箱 ↔ 其余**：无依赖。它只替换官方的进程沙箱与文件系统服务。
- **会话编辑内部**：契约层 `@morlay/session-branch` → 编排层 `@morlay/ui-conversation-message-actions` →
  实现层 `@morlay/session-rdb`；装配决策（禁用官方 jsonl、rdb 替换、settings 覆盖）归聚合层
  `@morlay/better-session`（`cordis.patch.yml` +
  [ADR-20260917-rdb替换官方jsonl持久化](../packages/session/better-session/.agents/adrs/20260917-rdb替换官方jsonl持久化.md)、
  [ADR-20260917-配置经settings服务覆盖而非直接改cordis配置](../packages/session/better-session/.agents/adrs/20260917-配置经settings服务覆盖而非直接改cordis配置.md)）。
- **对话 UI 接管 → 会话编辑**：`session/ui-conversation`（唯一的薄壳 fork 包）与 `client/ui-primitives` 提供 client 半的
  渲染与输入基础，编排层的 client 半在其上做槽位替换与覆盖（槽位与接管面见边界表与
  [债务 临时接管上游对话UI的client半](../packages/session/ui-conversation/.agents/debts/20260917-临时接管上游对话UI的client半.md)）；
  `context/dsh-reference` 的引用展开不依赖通道服务（`inject` 只有 `skills`），装在同一 profile 的
  `@morlay/better-session` patch 里，因此各模式都生效——chat 模式靠「没有 `read` / `skill` 工具就不展开」自然收口。
- **仓库 → 上游**：`vendor/deepseek-harness/` 是上游按版本克隆的 side workspace（`DEEPSEEK_HARNESS_VERSION`
  锁定），本仓库所有包经 `workspace:*` 解析到该固定版本源码（见
  [ADR-上游以side-workspace版本锁定完整代码而非发布版本](./adrs/20260917-上游以side-workspace版本锁定完整代码而非发布版本.md)）。

## 分层

`.agents/` 的目录布局与命名 / 引用规则见 [`.agents/README.md`](./README.md)；这里只负责「哪个上下文在哪」。
