import { provide, type ProviderList, configure } from "@morlay/zephyr";
import { WebDefault } from "../web.service.ts";
import { WebSearchDeepseek } from "../web-search-deepseek.service.ts";
import { WebFetchHttp } from "../web-fetch-http.service.ts";

const providers = (): ProviderList => [
  configure(WebDefault, { searchProvider: "deepseek-official", fetchProvider: "http" })([WebDefault]),
  configure(WebSearchDeepseek, { apiKeyEnv: "DEEPSEEK_API_KEY" })([WebSearchDeepseek]),
  WebFetchHttp,
];

export const provideWebAccess = provide(providers());
