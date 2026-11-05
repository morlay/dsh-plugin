import { provide } from "@morlay/zephyr";
import { WebDefault } from "../web.service.ts";
import { WebSearchDeepseek } from "../web-search-deepseek.service.ts";
import { WebFetchHttp } from "../web-fetch-http.service.ts";
import { WebSearchOllama } from "../web-search-ollama.service.ts";

// 两个搜索后端都装：`searchProvider` 只在**调用时**解析（上游 `WebRuntime` 的选择语义是
// "resolved at execution time, never order-dependent"），所以清单顺序不影响"默认选谁"。
export const provideWebAccess = provide([
  // 默认走 ollama（`dsh-plugin-main` 的 ollama-provider-profile 就是这套）；deepseek 那条仍可用。
  { provide: WebDefault, config: { searchProvider: "ollama", fetchProvider: "http" } },
  { provide: WebSearchDeepseek, config: { apiKeyEnv: "DEEPSEEK_API_KEY" } },
  { provide: WebSearchOllama, config: { apiKeyEnv: "OLLAMA_API_KEY" } },
  WebFetchHttp,
]);
