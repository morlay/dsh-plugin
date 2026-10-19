import { Module, type ProviderList } from "@morlay/zephyr";
import { WebDefault } from "./web.service.ts";
import { WebSearchDeepseek } from "./web-search-deepseek.service.ts";
import { WebFetchHttp } from "./web-fetch-http.service.ts";

const providers = (): ProviderList => [
  WebDefault.withConfig({ searchProvider: "deepseek-official", fetchProvider: "http" }),
  WebSearchDeepseek.withConfig({ apiKeyEnv: "DEEPSEEK_API_KEY" }),
  WebFetchHttp,
];

@Module({ providers: providers() })
export class WebModule {
  static withConfig(): ProviderList {
    return providers();
  }
}
