/** 本包在配置页上的字段文案（命名空间 `settings.web-search-ollama`）。 */

export const zh = {
  apiKey: "API key",
  apiKeyHint: "字面值；能走凭证服务时优先用下面的引用名，别把密钥写进配置文件。",
  apiKeyEnv: "凭证引用名",
  apiKeyEnvHint: "每次搜索经凭证服务解析一次；默认 `OLLAMA_API_KEY`。",
  baseURL: "端点",
  baseURLHint: "端点根，`/api/web_search` 由 provider 拼；默认 https://ollama.com。",
  maxResults: "默认结果数",
  maxResultsHint: "请求没带结果数时用它；留空就是让 Ollama 用自己的默认。",
} as const;

export const en: Record<keyof typeof zh, string> = {
  apiKey: "API key",
  apiKeyHint: "Literal value; prefer the credential reference below and never inline secrets.",
  apiKeyEnv: "Credential reference",
  apiKeyEnvHint:
    "Resolved through the credentials service per search; defaults to `OLLAMA_API_KEY`.",
  baseURL: "Endpoint",
  baseURLHint:
    "Endpoint root; the provider appends `/api/web_search`. Defaults to https://ollama.com.",
  maxResults: "Default result count",
  maxResultsHint: "Used when a request carries none; unset keeps Ollama's own default.",
};

export type WebSearchFieldLocaleKey = keyof typeof zh;
