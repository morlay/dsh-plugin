import type { Volatile } from "@deepseek-ai/cosmokit";
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

/**
 * schema 解析之后的形状：四个字段都是 **volatile 稳定引用**，读它要过 `.get()`。
 *
 * 它们都标了 `.volatile()`（插件行里唯一可实时改的字段），所以设置页改完不用重挂这一行：provider 的每一次
 * 请求、每一次取 key 都现场读引用。
 */
export interface ResolvedConfig {
  readonly apiKey: Volatile<string | undefined>;
  readonly apiKeyEnv: Volatile<string | undefined>;
  readonly baseURL: Volatile<string | undefined>;
  readonly maxResults: Volatile<number | undefined>;
}

/**
 * 本地化说明：`description()` 的类型签名只声明 `string`，而 meta 本身接受 `Dict<string>`
 * （`vendor/schemastery/src/index.ts` 的 `mergeDesc` 就是按字典合并的），所以这里只做一次类型放行。
 */
const localized = (text: { zh: string; en: string }): string => text as unknown as string;

export const Config: z<Config, ResolvedConfig> = z.object({
  apiKey: z
    .string()
    .role("secret")
    .description(
      localized({
        zh: "Ollama 的 API key 字面值；能用凭证服务时优先用下面的引用名，别把密钥写进配置文件。",
        en: "Literal Ollama API key. Prefer the credential reference below; do not put secrets in a config file.",
      }),
    )
    .volatile(),
  apiKeyEnv: z
    .string()
    .role("credential-ref")
    .description(
      localized({
        zh: "凭证引用名（默认 `OLLAMA_API_KEY`）：每次搜索经凭证服务解析一次。",
        en: "Credential reference resolved through the credentials service on every search (default `OLLAMA_API_KEY`).",
      }),
    )
    .volatile(),
  baseURL: z
    .string()
    .description(
      localized({
        zh: "端点根，`/api/web_search` 由 provider 拼；默认 https://ollama.com。",
        en: "Endpoint root; the provider appends `/api/web_search`. Defaults to https://ollama.com.",
      }),
    )
    .volatile(),
  maxResults: z
    .number()
    .step(1)
    .min(1)
    .description(
      localized({
        zh: "请求没带结果数时用的默认值；省略就是让 Ollama 用自己的默认。",
        en: "Default result count when a request carries none; unset keeps Ollama's own default.",
      }),
    )
    .volatile(),
});

export function apply(ctx: Context, config: ResolvedConfig): void {
  // provider 每次都从 options 读，所以这里用 getter 把「现场读引用」接上去：改配置即下一次请求生效。
  const options = {
    get apiKey(): string | undefined {
      const literal = config.apiKey.get();
      return literal !== undefined && literal.length > 0 ? literal : undefined;
    },
    resolveApiKey: async () => {
      const reference = credentialRef(config.apiKeyEnv.get() ?? DEFAULT_API_KEY_ENV);
      const credentials = ctx.get("credentials");
      if (credentials !== undefined) return (await credentials.resolve(reference))?.value;
      // 没有凭证服务时环境就是整个凭证面。
      const ambient = launchEnvironmentOf(ctx).get(reference);
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined;
    },
    get apiKeyEnv(): string {
      return config.apiKeyEnv.get() ?? DEFAULT_API_KEY_ENV;
    },
    get baseURL(): string {
      return config.baseURL.get() ?? OLLAMA_DEFAULT_BASE_URL;
    },
    get maxResults(): number | undefined {
      return config.maxResults.get();
    },
  };
  ctx.web.registerSearchProvider(new OllamaSearchProvider(options));
}
