// Ollama 搜索后端的**行**：把 provider 注册进 `ctx.web`，配置来自装配面。
//
// 与 `WebSearchDeepseek` 的区别：那一行是上游插件的适配行（它自己读凭证服务），这一份是纯实现行
// （上游没有对应的包，见 `web-search-ollama.provider.ts` 的头注释）。
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { Web } from "./contract/web.contract.ts";
import {
  OLLAMA_DEFAULT_BASE_URL,
  OllamaSearchProvider,
  type OllamaSearchProviderOptions,
} from "./web-search-ollama.provider.ts";

/** 行配置（`configure(WebSearchOllama, {...})` 叠的值）。 */
export interface WebSearchOllamaConfig {
  readonly apiKey?: string;
  readonly apiKeyEnv?: string;
  readonly baseURL?: string;
  readonly maxResults?: number;
}

@Injectable()
export class WebSearchOllama {
  private readonly web = inject(Web);

  /** 行配置：`configure(...)` 的 patch 由基类构造接住。 */
  private readonly config: WebSearchOllamaConfig;

  constructor(config: WebSearchOllamaConfig = {}) {
    this.config = config;
  }

  onInit(ctx: Context): void {
    const options: OllamaSearchProviderOptions = {
      apiKeyEnv: this.config.apiKeyEnv ?? "OLLAMA_API_KEY",
      baseURL: this.config.baseURL ?? OLLAMA_DEFAULT_BASE_URL,
      ...(this.config.apiKey === undefined ? {} : { apiKey: this.config.apiKey }),
      ...(this.config.maxResults === undefined ? {} : { maxResults: this.config.maxResults }),
    };
    const dispose = this.web.registerSearchProvider(new OllamaSearchProvider(options));
    ctx.effect(() => dispose);
  }
}
