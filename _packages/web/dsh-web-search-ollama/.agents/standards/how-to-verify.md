# 如何验证（@morlay/dsh-web-search-ollama）

`src/__tests__/` 是 mock 单测，默认 `just test` 覆盖：请求形状与 maxResults 上限、响应映射、错误码、
行入口形状，以及装进 `ctx.web` 后的一次搜索。

没有额外的 e2e 配置：结果依赖环境里的 key 与 Ollama 服务端行为，不能当判据（配置面本身也由单测覆盖）。
