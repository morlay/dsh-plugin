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
      name: "@morlay/dsh-web-search-ollama/cordis-register"
- id: web-search-ollama
  config:
    apiKeyEnv: OLLAMA_API_KEY
```

配置四个字段：`apiKey`（字面 key）、`apiKeyEnv`（凭证引用，默认 `OLLAMA_API_KEY`）、`baseURL`（默认
`https://ollama.com`）、`maxResults`；四个都可实时改，不用重挂这一行。

上游的 Anthropic Messages 后端在 Ollama 上不成立，所以本包直接接 Ollama 的 REST——原因、结果映射、错误面与字段
边界见[设计 Ollama 搜索后端](./.agents/designs/20260929-ollama搜索后端.md)。

## 装配

注册行由本包的 `./cordis-register` 出口给出（默认导出），采用它的部署 bundle 是
[`@morlay/ollama-provider-profile`](../../bundles/ollama-provider-profile/README.md)：它渲染 patch，并在同一份 patch
里给 `web` 行的 `searchProvider: ollama` 与 key 引用。注册行在 host 平面只装一次（同一个 provider id 注册两次会撞
`WEB_DUPLICATE_PROVIDER`）。

行入口是本包的默认导出：`@Injectable()` 的 `WebSearchOllama` class Provider 自身就是 `WebSearchProvider`
（构造参数收 `ResolvedConfig`，`web = inject(Web)` 经适配令牌取上游 `ctx.web`，`onInit(ctx)` 里
`registerSearchProvider(this)`——不再 `new` 一份实现），由 `toCordis()` 转成 Loader 认的 `name` / `Config` /
`apply`，不再声明字符串 `inject` 数组。行 id 由 patch 的 `id` 决定（`web-search-ollama`），与 Provider 的
token 名同形。
