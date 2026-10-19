import type { Volatile } from "@deepseek-ai/cosmokit";
import z from "@deepseek-ai/schemastery";
import { credentialRef, Credentials, LaunchEnvironment } from "@morlay/dsh-base/agent";
import { HttpFetch, Web } from "@morlay/dsh-base/web";
import { configuredProvider, inject, Injectable } from "@morlay/zephyr";
import {
  OLLAMA_DEFAULT_BASE_URL,
  OllamaSearchProvider,
  type OllamaSearchProviderOptions,
} from "./provider.ts";

// 与 `llm-pi-ai` 的 ollama route 共用同一个 key 引用。
const DEFAULT_API_KEY_ENV = "OLLAMA_API_KEY";

export interface Config {
  // 字面 key；优先用 `apiKeyEnv` 走凭证服务，别把密钥写进配置文件。
  apiKey?: string;
  // 每次搜索解析一次的凭证引用；缺省 `OLLAMA_API_KEY`。
  apiKeyEnv?: string;
  // 端点根；`/api/web_search` 由 provider 拼。缺省 ollama.com。
  baseURL?: string;
  // 请求没带 `maxResults` 时的默认结果数；省略表示让 Ollama 用自己的默认。
  maxResults?: number;
}

// schema 解析之后的形状：四个字段都是 **volatile 稳定引用**（插件行里唯一可实时改的字段），读它要过 `.get()`。
// 设置页改完不用重挂这一行：provider 的每次请求、每次取 key 都现场读引用。
export interface ResolvedConfig {
  readonly apiKey: Volatile<string | undefined>;
  readonly apiKeyEnv: Volatile<string | undefined>;
  readonly baseURL: Volatile<string | undefined>;
  readonly maxResults: Volatile<number | undefined>;
}

// 本地化说明：`description()` 的类型签名只声明 `string`，而 meta 本身接受 `Dict<string>`
// （`vendor/schemastery/src/index.ts` 的 `mergeDesc` 就是按字典合并的），所以这里只做一次类型放行。
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

// provider 每次都从 options 读，所以这里用 getter 把「现场读引用」接上去：改配置即下一次请求生效。
function optionsOf(
  config: ResolvedConfig,
  resolveApiKey: (name: string) => Promise<string | undefined>,
  fetchImpl: typeof fetch | undefined,
): OllamaSearchProviderOptions {
  return {
    get apiKey(): string | undefined {
      const literal = config.apiKey.get();
      return literal !== undefined && literal.length > 0 ? literal : undefined;
    },
    resolveApiKey: () => resolveApiKey(config.apiKeyEnv.get() ?? DEFAULT_API_KEY_ENV),
    get apiKeyEnv(): string {
      return config.apiKeyEnv.get() ?? DEFAULT_API_KEY_ENV;
    },
    get baseURL(): string {
      return config.baseURL.get() ?? OLLAMA_DEFAULT_BASE_URL;
    },
    get maxResults(): number | undefined {
      return config.maxResults.get();
    },
    ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
  };
}

@Injectable()
export class WebSearchOllama extends OllamaSearchProvider {
  // 行配置的输入形状是 `Config`（Loader 用 schema 解析成 ResolvedConfig 后才进构造参数）。
  static readonly withConfig = (config: Config) =>
    configuredProvider(WebSearchOllama, config, {
      resolve: (value) => Config(value as Config),
    });

  // 只消费上游 `web` 服务，不发布服务；注入走适配令牌，不再是字符串 inject 数组。
  web = inject(Web);

  // 宿主没配 HTTP 执行器时 provider 用全局 fetch。
  http = inject.optional(HttpFetch);

  credentials = inject.optional(Credentials);

  launchEnvironment = inject.optional(LaunchEnvironment);

  private unregister: (() => void) | undefined;

  constructor(config: ResolvedConfig) {
    // options 在 search 时才读，那时字段注入已完成。
    super(() => optionsOf(config, (name) => this.keyOf(name), this.http));
  }

  // 凭证服务优先，启动环境兜底：一次操作解析一次，改完凭证下一次搜索就生效。
  private async keyOf(name: string): Promise<string | undefined> {
    const reference = credentialRef(name);
    if (this.credentials !== undefined) return (await this.credentials.resolve(reference))?.value;
    return this.launchEnvironment?.get(reference)?.value;
  }

  onInit(): void {
    // Provider 自身就是搜索后端：注册同一个实例，不在 onInit 里再 new 一份实现。
    this.unregister = this.web.registerSearchProvider(this);
  }

  onDispose(): void {
    this.unregister?.();
  }
}
