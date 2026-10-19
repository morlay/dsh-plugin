# @morlay/ollama-provider-profile

[![NPM Version](https://img.shields.io/npm/v/%2540morlay%252Follama-provider-profile)](https://www.npmjs.com/package/@morlay/ollama-provider-profile)
[![NPM Downloads](https://img.shields.io/npm/dw/%40morlay%2Follama-provider-profile)](https://www.npmjs.com/package/@morlay/ollama-provider-profile)
[![NPM Downloads (18 months)](https://img.shields.io/npm/d18m/%2540morlay%252Follama-provider-profile)](https://www.npmjs.com/package/@morlay/ollama-provider-profile)

Ollama 一家：llm route（`llm-pi-ai` 的 ollama provider）、搜索后端的注册行、`web` 行的 provider 选择与 key 引用。

| 装什么                                                                   | 数据从哪来                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web-search-ollama` 注册行 / `llm-pi-ai` 的 ollama provider / `web` 配置 | [`src/zephyr.module.ts`](./src/zephyr.module.ts) 的 `providers`：`WebSearchOllama.withConfig(...)` / `LlmPiAi.withConfig` / `Web.withConfig` |

`@Module` 是 patch 真源：providers 里的 class 是唯一运行期装配面，不再手写 `dsh.rows` 与字符串 id。
能力包的行名（`<包名>/cordis-register`）由 Provider 定义文件所属的 `package.json` 推导；官方行只覆盖 config，不 insert。
`tsdown.config.ts` 用 `@local/zephyr-codegen` 生成包根的 `cordis.patch.yml`，构建时写回，生成物入库、不手改。

基础面（`@morlay/dsh-client-ui-primitives`）随用到它的 client 行内联，本包不插这一行。

后端为什么必须走 Ollama 自己的 `/api/web_search`（而不是把上游 messages 后端指过去）见
[能力包的 README](../../web/dsh-web-search-ollama/README.md)。
