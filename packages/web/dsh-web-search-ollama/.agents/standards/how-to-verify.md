# 如何验证（@morlay/dsh-web-search-ollama）

`src/__tests__/` 是 mock 单测（请求形状、映射、错误码、`ctx.web` 注册），默认 `just test` 覆盖它们。

真打 `https://ollama.com/api/web_search` 的 e2e 在 [`e2e/`](../../e2e)，**不在根 vitest 的 include 里**：
默认收集会让"环境里恰好有 key"变成静悄悄打外网、花额度、结果还看运气。显式触发（key 从启动环境注入）：

```sh
mise exec -- pnpm --filter @morlay/dsh-web-search-ollama run test:e2e
```

门控与判据：

- `OLLAMA_API_KEY` 缺席时整体 skip（CI 没有这个 key），不静默降级成 mock；
- 通过判据是**两条都过**：provider 直连拿回可引用 source，以及 provider 装进 `ctx.web` 后选中它的一次搜索；
- 单测全绿**不能**替代它：本包第一版把搜索配到 Ollama 的 Anthropic Messages 端点、mock 全绿，真调用是错的
  （Ollama 把 `web_search_20250305` 降级成客户端工具、不执行搜索）。
