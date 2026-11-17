# @morlay/dsh-agent

agent 的运行时骨架：会话与 agent 的注册表、LLM 调用、系统提示词、工具注册表和 agent loop。

## 用法

- 导出：`AgentDirectory` / `Llm` / `SystemPrompt` / `ToolRegistry` / `AgentLoop` / `AgentDefaultModel` / `LaunchEnvironment` 七个契约与各自的默认实现。
- 装配：`provideAgent()`（包根，含 `TimerDefault`）；其余域从这里取契约，不复制实现。
- `WorkingDirectory.defaultDirectory`（新会话的起始目录）不给时取 `AppEnv.defaultWorkingDirectory`：
  环境事实只有一个来源，装配面要另给值就 `configure(WorkingDirectoryDefault, { defaultDirectory })`。
- 域内只有一条行、没有第二个消费者的留在这里，不单开包：`TimerDefault`（令牌就是上游 `TimerService`）与 `LaunchEnvironmentDefault`（读者是上游 `launchEnvironmentOf`，不在本包的 `provideAgent()` 清单里）。

## LLM provider 的配置行（`provideLlmProviders()`）

两家 provider 各一行，设置项由 `@Setting` 声明（`llm-deepseek-api-key` / `llm-pi-ai`）：

- 配置来自三层：schema 默认 → 装配层（`configure(实现类, patch)`）→ `settings.json`（用户在设置页改的）。
- 密钥**不进行 config**：profile 里只放引用（`apiKeyEnv`），值在请求期由凭证服务或启动环境解析。
- profile 的 `headers` 支持**环境引用**：`Authorization: "Bearer ${OLLAMA_API_KEY}"`。
  `LlmPiAi` 在挂载前按启动环境快照（进程环境 → 项目 `.env` → `$DSH_HOME/.env`）解析，结果只进运行期 config；
  装配层因此只持有引用字符串。取不到的引用会把那个头摘掉，而不是发半截值。

为什么需要这条（pi-ai 的 Anthropic 实现发 `x-api-key`、网关要 `Authorization: Bearer`），见
[provider 头里的环境引用](../.agents/designs/20261122-provider头的环境引用.md)。

## 设计

包内子域怎么分、契约与行各放哪，见[包内子域拆分与注册抽象](../.agents/designs/20261028-包内子域拆分与注册抽象.md)。
