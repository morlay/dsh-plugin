# @morlay/dsh-web-search-ollama

往 `ctx.web` 注册一个搜索后端：`web_search` 的检索走 Ollama 自己的
`POST https://ollama.com/api/web_search`，用与 `llm-pi-ai` 的 ollama route 同一个 `OLLAMA_API_KEY`。

## 用法

本包只提供行数据；采用它的部署 bundle 渲染出的装配（节选）：

```yaml
- id: web
  config:
    searchProvider: ollama
    fetchProvider: http
- insert:
    - id: web-search-ollama
      name: "@morlay/dsh-web-search-ollama"
- id: web-search-ollama
  config:
    apiKeyEnv: OLLAMA_API_KEY
```

配置四个字段：`apiKey`（字面 key）、`apiKeyEnv`（凭证引用，默认 `OLLAMA_API_KEY`）、`baseURL`（默认
`https://ollama.com`）、`maxResults`（缺省用 Ollama 的默认，硬上限 10）。四个都可实时改，不用重挂这一行。

上游的 Anthropic Messages 后端在 Ollama 上不成立（Ollama 把 `web_search_20250305` 降级成客户端工具、不执行搜索），
所以本包直接接 Ollama 的 REST——原因、结果映射、错误面与装配链路见
[设计 Ollama 搜索后端](./.agents/designs/20260929-ollama搜索后端.md)。

## 装配

注册行由本包的 `./rows` 出口给出，采用它的部署 bundle 是
[`@morlay/ollama-provider-profile`](../../bundles/ollama-provider-profile/README.md)：它渲染 patch，并在同一份 patch
里给 `web` 行的 `searchProvider: ollama` 与 key 引用。注册行在 host 平面只装一次，同一个 provider id 注册两次会撞
`WEB_DUPLICATE_PROVIDER`。
