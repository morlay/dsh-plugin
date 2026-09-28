# @morlay/ollama-provider-profile

Ollama 一家：llm route（`llm-pi-ai` 的 ollama provider）、搜索后端的注册行、`web` 行的 provider 选择与 key 引用。

| 装什么                                                             | 数据从哪来                                                                                   |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `web-search-ollama` 注册行                                         | [`@morlay/dsh-web-search-ollama/rows`](../../packages/web/dsh-web-search-ollama/src/rows.ts) |
| `llm-pi-ai` 的 ollama provider / `web` 的 provider 选择 / key 引用 | 本包的 `tsdown.config.ts`                                                                    |

后端为什么必须走 Ollama 自己的 `/api/web_search`（而不是把上游 messages 后端指过去）见
[能力包的 README](../../packages/web/dsh-web-search-ollama/README.md)。
