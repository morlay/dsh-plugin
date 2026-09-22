import type { Context } from "@deepseek-ai/cordis";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import type {} from "@deepseek-ai/dsh-web";
import z from "@deepseek-ai/schemastery";
import { OLLAMA_DEFAULT_BASE_URL, OllamaSearchProvider } from "./provider.ts";

export {
  OLLAMA_DEFAULT_BASE_URL,
  OLLAMA_DEFAULT_MAX_RESULTS,
  OLLAMA_MAX_RESULTS_LIMIT,
  OLLAMA_PROVIDER_ID,
  OllamaSearchProvider,
  mapOllamaResponse,
  mapOllamaResult,
} from "./provider.ts";
export type { OllamaSearchProviderOptions } from "./provider.ts";

export const name = "web-search-ollama";

/** 只往 `ctx.web` 注册后端，不发布服务。 */
export const inject = ["web"];

/** 与 `llm-pi-ai` 的 ollama route 共用同一个 key 引用。 */
const DEFAULT_API_KEY_ENV = "OLLAMA_API_KEY";

export interface Config {
  /** 字面 key；优先用 `apiKeyEnv` 走凭证服务，别把密钥写进配置文件。 */
  apiKey?: string;
  /** 每次搜索解析一次的凭证引用；缺省 `OLLAMA_API_KEY`。 */
  apiKeyEnv?: string;
  /** 端点根；`/api/web_search` 由 provider 拼。缺省 ollama.com。 */
  baseURL?: string;
  /** 请求没带 `maxResults` 时的默认结果数；省略表示让 Ollama 用自己的默认。 */
  maxResults?: number;
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role("secret"),
  apiKeyEnv: z.string().role("credential-ref"),
  baseURL: z.string(),
  maxResults: z.number().step(1).min(1),
});

export function apply(ctx: Context, config: Config): void {
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV);
  const literal =
    config.apiKey !== undefined && config.apiKey.length > 0 ? config.apiKey : undefined;
  ctx.web.registerSearchProvider(
    new OllamaSearchProvider({
      ...(literal === undefined ? {} : { apiKey: literal }),
      resolveApiKey: async () => {
        const credentials = ctx.get("credentials");
        if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value;
        // 没有凭证服务时环境就是整个凭证面。
        const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv);
        return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined;
      },
      apiKeyEnv,
      baseURL: config.baseURL ?? OLLAMA_DEFAULT_BASE_URL,
      ...(config.maxResults === undefined ? {} : { maxResults: config.maxResults }),
    }),
  );
}
