# @morlay/ollama-provider-profile

> **私有包**：只在本地/本仓库内使用，不对外发布（`private: true`，无 `publishConfig`）。

Ollama 一家：llm route（`llm-pi-ai` 的 ollama provider，Chat Completions 形态）、搜索后端的注册行、`web` 行的
provider 选择与 key 引用。

| 装什么                                                             | 数据从哪来                                                                          |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `web-search-ollama` 注册行                                         | [`@morlay/dsh-web-search-ollama/rows`](../../web/dsh-web-search-ollama/src/rows.ts) |
| `llm-pi-ai` 的 ollama provider / `web` 的 provider 选择 / key 引用 | 本包的 `tsdown.config.ts`                                                           |

基础面（`@morlay/dsh-client-ui-primitives`）随用到它的 client 行内联，本包不插这一行。

provider 走 `api: openai-completions` + `baseURL: https://ollama.com/v1`（Ollama 的 OpenAI 兼容端点），鉴权用
`Authorization: Bearer`。Ollama 的两个实现都是子集：**不支持 prompt caching、deferred tools 与 tool_choice**，
也不承诺把中途的 system 消息读成有效提示词——`supportsMidConvo*` 在 `llm-pi-ai` 的 `catalog.ts` 里是 `withhold`，
配置层拿不到，所以系统提示词与工具的变化都走每步全量。要 in-history 与按需工具的前缀缓存收益，用官方
`deepseek-official` 路由。

后端为什么必须走 Ollama 自己的 `/api/web_search`（而不是把上游 messages 后端指过去）见
[能力包的 README](../../web/dsh-web-search-ollama/README.md)。

**插件页不挂长文**：`locale/*.json` 的 `meta.detail` 指向空文件 [`docs/detail.md`](./docs/detail.md)，所以 bundle 详情页的"详细介绍"区是空的；本 README 仍是包门面。
