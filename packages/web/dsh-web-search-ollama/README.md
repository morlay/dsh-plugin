# @morlay/dsh-web-search-ollama

往 `ctx.web` 注册一个搜索后端：`web_search` 的检索走 Ollama 自己的
`POST https://ollama.com/api/web_search`，用与 `llm-pi-ai` 的 ollama route 同一个
`OLLAMA_API_KEY`。

## 为什么不是"复用上游的 messages 后端"

上游 `@deepseek-ai/dsh-web-search-deepseek` 走 Anthropic Messages 的
`web_search_20250305` server tool，看起来只要把 `baseURL` 指到 `https://ollama.com/v1` 就能白拿
Ollama 的搜索。**实测不行**：真发一次

```sh
curl https://ollama.com/v1/messages -H "Authorization: Bearer $OLLAMA_API_KEY" \
  -H "anthropic-version: 2023-06-01" -H "content-type: application/json" \
  -d '{"model":"deepseek-v4.1-flash","max_tokens":4096,
       "messages":[{"role":"user","content":[{"type":"text","text":"Perform a web search for the query: cordis plugin framework"}]}],
       "tools":[{"type":"web_search_20250305","name":"web_search","max_uses":5}]}'
```

回的 `content` 块只有 `thinking` + `tool_use`（`stop_reason: tool_use`）——**Ollama 把这个 server
tool 降级成普通客户端工具，它不自己执行搜索**，要求调用方执行后再回传 `tool_result`。而那个上游
provider 只认服务端自执行后返回的 `web_search_tool_result` 块，找不到就报
`WEB_PROVIDER_ERROR`（"returned no web_search_tool_result blocks"）。Ollama 官方文档那句
"hosted web search are not fully supported"（[docs.ollama.com/api/anthropic-compatibility](https://docs.ollama.com/api/anthropic-compatibility)）
就是这个意思，[issue #17283](https://github.com/ollama/ollama/issues/17283) 里说的
`WebSearchAnthropicWriter` 拦截只发生在本地 server 的 cloud 模型路径上。

Ollama 真正对外提供搜索的是它自己的 REST 接口——同一个 key、一次 HTTP、返回扁平
`{results:[{title,url,content}]}`：

```sh
curl https://ollama.com/api/web_search -H "Authorization: Bearer $OLLAMA_API_KEY" \
  -H "content-type: application/json" -d '{"query":"cordis plugin framework"}'
```

本包就是把这一条接进 `ctx.web`，代价只有一个 ~200 行的 provider。

## 配置

| 字段         | 默认                     | 含义                                                       |
| ------------ | ------------------------ | ---------------------------------------------------------- |
| `apiKey`     | —                        | 字面 key；优先用下面那个引用，别把密钥写进配置文件         |
| `apiKeyEnv`  | `OLLAMA_API_KEY`         | 每次搜索解析一次的凭证引用（凭证服务，缺席时回退启动环境） |
| `baseURL`    | `https://ollama.com`     | 端点根；`/api/web_search` 由 provider 拼                   |
| `maxResults` | —（Ollama 自己的默认 5） | 请求没带 `maxResults` 时的默认结果数                       |

## 行为

- **结果映射**：每条 `results[]` 给一个 source；`title` / `content` 空串视为缺失
  （`content` → `snippet`），**没有 `url` 的条目直接丢掉**（seam 的 source 必须有 url）。
  Ollama 不返回生成式答案，所以结果里没有 `content` 字段。
- **`max_results` 上限 10**：Ollama 的硬上限；请求与配置给出的更大值在发出前压到 10。
- **错误码**：HTTP 失败 → `WEB_PROVIDER_ERROR`（优先用响应体里的 `error` 文案，非 JSON 体退回
  `Ollama API error (HTTP <status>)`）；网络失败 → `WEB_PROVIDER_ERROR`；取消 → `WEB_ABORTED`
  （任何阶段，含读体）；取不到 key → `WEB_PROVIDER_CREDENTIAL_MISSING` 且不发请求。
- **可用性检查不联网**：`available()` 只看 key 有没有来源、`baseURL` 能否解析。

## 验证

`src/__tests__/provider.spec.ts` 是 mock 单测，默认 `just test` 覆盖它。链路是否真的成立由
[`e2e/provider.e2e.spec.ts`](./e2e/provider.e2e.spec.ts) 打真端点守——**它刻意放在 `src/__tests__/` 之外**：
根 `vitest.config.ts` 的 include 收不到它，默认全量测试不会去打外网，只由显式命令触发（`OLLAMA_API_KEY`
从启动环境注入，缺席则整体跳过）：

```sh
mise exec -- pnpm --filter @morlay/dsh-web-search-ollama run test:e2e
```

两条都过才算通过：provider 直连拿回可引用 source，以及 provider 装进 `ctx.web` 后选中它再搜一次。别用
mock 全绿替代它——这个包的第一版就是"配置指到 Ollama 的 messages 端点"、mock 也全绿，真调用却是错的。
触发方式、门控与判据的 home 是[包层规范](./.agents/standards/how-to-verify.md)。

## 装配

注册行由 [`@morlay/dsh-preset`](../../preset/dsh-preset/README.md) 的 bundle patch 插在 **host 层**，
并把基础 bundle 的 `web` 行 `searchProvider` 切到 `ollama`：

```yaml
- id: web
  config:
    searchProvider: ollama
    fetchProvider: http
- insert:
    - id: web-search-ollama
      name: "@morlay/dsh-web-search-ollama"
      config:
        apiKeyEnv: OLLAMA_API_KEY
```

注册行不能放进 preset：preset 是每个 agent 各挂一份，同一个 provider id 注册两次会撞
`WEB_DUPLICATE_PROVIDER`；选择权在 `web` 行的 `searchProvider`，而那一行本来就是 host 行。

## 边界

- **只注册搜索后端**：`web_fetch` 仍走基础 bundle 的 `web-fetch-http`，本包不碰抓取。
- **一次只选一个后端**：`ctx.web` 的 `searchProvider` 是单选，默认 `ollama`；
  `deepseek-official` 后端仍由基础 bundle 注册着，改写那一行即可切回（但它需要 `DEEPSEEK_API_KEY`）。
- **不做设置页 section**：配置面就是那一行 patch（见
  [dsh-preset 的设计记录](../../preset/dsh-preset/.agents/designs/20260917-预设生成与装配.md)）。
