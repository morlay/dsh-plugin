# providers 采用 dict 多路由结构对齐 llm-pi-ai

状态：已采纳

背景：一个部署要同时接多个端点（本地 Ollama + 网关 + 云端），而 harness 按 provider 路由键选择 profile。

**决定**

`providers` 是 **dict：key 就是 provider 路由键**（选择器与
`GenerateOptions.provider` 使用），值是 profile——与内置 `llm-pi-ai` 的多路由
结构一致，现有配置近乎无缝迁移。

**考虑过的选项**

- **数组式 profiles**：`resolveProfiles` 对数组显式抛错（"providers is now
  a dict keyed by provider route, not an array of profiles"）——无法按路由键寻址，
  拒绝该形态。
- **单 provider 单配置**：无法表达多端点路由（Ollama + 网关 + 云端并存）。

**后果**

- 从 `llm-pi-ai` 搬一条路由：`providers.<route>` 的 `baseURL` / `models` / 采样字段同名平移；`apiKeyEnv` 与
  `retryPolicy` 原样保留；`reasoningEfforts` 的 `off` 空值语义一致。两处改名：profile 的
  `requestImageMaxBytes` → `maxRequestImageBytes`，模型的 `input` → `inputModalities`。本包没有 `api` 字段
  （协议固定 chat-completions）。
- 配置 schema 支持 **profile 级默认采样参数**，请求级
  `GenerateOptions.temperature` 优先——这是与内置 `llm-pi-ai` /
  `llm-deepseek` 的差异点（规则见
  [ADR-20260917-采样默认值合并规则与省略语义](./20260917-采样默认值合并规则与省略语义.md)）。
