# @morlay/ollama-provider-profile

[![NPM Version](https://img.shields.io/npm/v/%2540morlay%252Follama-provider-profile)](https://www.npmjs.com/package/@morlay/ollama-provider-profile)
[![NPM Downloads](https://img.shields.io/npm/dw/%40morlay%2Follama-provider-profile)](https://www.npmjs.com/package/@morlay/ollama-provider-profile)
[![NPM Downloads (18 months)](https://img.shields.io/npm/d18m/%2540morlay%252Follama-provider-profile)](https://www.npmjs.com/package/@morlay/ollama-provider-profile)

Ollama 一家：llm route（`llm-pi-ai` 的 ollama provider）、搜索后端的注册行、`web` 行的 provider 选择与 key 引用。

| 装什么                                                             | 数据从哪来                                                                          |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `web-search-ollama` 注册行                                         | [`@morlay/dsh-web-search-ollama/rows`](../../web/dsh-web-search-ollama/src/rows.ts) |
| `llm-pi-ai` 的 ollama provider / `web` 的 provider 选择 / key 引用 | 本包的 `tsdown.config.ts`                                                           |

基础面（`@morlay/dsh-client-ui-primitives`）随用到它的 client 行内联，本包不插这一行。

后端为什么必须走 Ollama 自己的 `/api/web_search`（而不是把上游 messages 后端指过去）见
[能力包的 README](../../web/dsh-web-search-ollama/README.md)。

**插件页不挂长文**：`locale/*.json` 的 `meta.detail` 指向空文件 [`docs/detail.md`](./docs/detail.md)，所以 bundle 详情页的"详细介绍"区是空的；本 README 仍是包门面。
