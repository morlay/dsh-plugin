import { WebError } from "@deepseek-ai/dsh-web";
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from "@deepseek-ai/dsh-web";
import type { OllamaError, OllamaSearchResponse, OllamaSearchResult } from "./types.ts";

/** 注册进 `ctx.web` 的 id；与 llm route 同名，配置里看到的就是同一个"ollama"。 */
export const OLLAMA_PROVIDER_ID = "ollama";

/** 默认端点；`/api/web_search` 是操作。 */
export const OLLAMA_DEFAULT_BASE_URL = "https://ollama.com";

/** Ollama 服务端自己的默认结果数。 */
export const OLLAMA_DEFAULT_MAX_RESULTS = 5;

/** Ollama `max_results` 的硬上限；超过它的值不发给服务端。 */
export const OLLAMA_MAX_RESULTS_LIMIT = 10;

/** 每次请求带的归属头。 */
const USER_AGENT = "morlay-dsh-plugin/0.0.1";

export interface OllamaSearchProviderOptions {
  /** 字面 key；给了就压过 {@link resolveApiKey}。 */
  apiKey?: string;
  /** 运行期取 key 的入口（凭证服务 / 环境）；返回空表示取不到。 */
  resolveApiKey?: () => Promise<string | undefined>;
  /** 取不到 key 时报出来的引用名，便于用户知道去哪配。 */
  apiKeyEnv: string;
  baseURL: string;
  /** 请求没给 `maxResults` 时用的默认值；省略表示让 Ollama 用它自己的默认。 */
  maxResults?: number;
}

/** 一条 Ollama 结果 → 一个 source；没有 url 就丢掉（seam 的 source 必须有 url）。 */
export function mapOllamaResult(result: OllamaSearchResult): WebSearchSource | undefined {
  const url = result.url;
  if (typeof url !== "string" || url.length === 0) return undefined;
  const title =
    typeof result.title === "string" && result.title.length > 0 ? result.title : undefined;
  const snippet =
    typeof result.content === "string" && result.content.length > 0 ? result.content : undefined;
  return {
    url,
    ...(title === undefined ? {} : { title }),
    ...(snippet === undefined ? {} : { snippet }),
  };
}

/** 响应信封 → 归一化结果；形状不对就抛（由调用方包成 `WEB_PROVIDER_ERROR`）。 */
export function mapOllamaResponse(response: OllamaSearchResponse): WebSearchResult {
  const results = response.results;
  if (results !== undefined && !Array.isArray(results)) {
    throw new TypeError("Ollama returned a non-array `results` field");
  }
  const sources = (results ?? [])
    .map((result) => mapOllamaResult(result))
    .filter((source): source is WebSearchSource => source !== undefined);
  // Ollama 不返回生成式答案（content 是每条结果的片段），所以没有 result.content；
  // 截断由 seam 负责，这里照实报 false。
  return { sources, truncated: false };
}

/** Ollama 的搜索后端；HTTP 重定向按 `WEB_PROVIDER_ERROR` 失败。 */
export class OllamaSearchProvider implements WebSearchProvider {
  readonly id = OLLAMA_PROVIDER_ID;

  constructor(private readonly options: OllamaSearchProviderOptions) {}

  available(): boolean {
    const { apiKey, resolveApiKey, baseURL, maxResults } = this.options;
    const hasKey = (apiKey !== undefined && apiKey.length > 0) || resolveApiKey !== undefined;
    return (
      hasKey && URL.canParse(baseURL) && (maxResults === undefined || isPositiveInteger(maxResults))
    );
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const apiKey = await this.apiKey();
    const maxResults = clampMaxResults(request.maxResults ?? this.options.maxResults);
    let response: Response;
    try {
      response = await fetch(`${this.options.baseURL}/api/web_search`, {
        method: "POST",
        redirect: "error",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          accept: "application/json",
          "user-agent": USER_AGENT,
        },
        body: JSON.stringify({
          query: request.query,
          ...(maxResults === undefined ? {} : { max_results: maxResults }),
        }),
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error: unknown) {
      if (isAbortError(error)) throw searchAborted(error);
      throw new WebError(`Ollama search request failed: ${String(error)}`, "WEB_PROVIDER_ERROR", {
        cause: error,
      });
    }

    if (!response.ok) {
      const status = response.status;
      let message = `Ollama API error (HTTP ${status})`;
      try {
        const parsed = (await response.json()) as OllamaError;
        const detail = parsed.error;
        if (typeof detail === "string" && detail.length > 0) message = detail;
      } catch (error: unknown) {
        // 取消不能吞成"HTTP 错误"：取消是 seam 的取消契约，不是 provider 故障。
        if (isAbortError(error)) throw searchAborted(error);
        // 其余情况状态行已经在 message 里，错误体不是 JSON 只损失一句更细的说明。
      }
      throw new WebError(message, "WEB_PROVIDER_ERROR");
    }

    try {
      return mapOllamaResponse((await response.json()) as OllamaSearchResponse);
    } catch (error: unknown) {
      if (isAbortError(error)) throw searchAborted(error);
      throw new WebError(
        `Ollama returned an unprocessable response body: ${String(error)}`,
        "WEB_PROVIDER_ERROR",
        {
          cause: error,
        },
      );
    }
  }

  /** 一次操作一份 key，不留在 provider 上；没有可用的 key 就点名引用，而不是发无授权请求。 */
  private async apiKey(): Promise<string> {
    const literal = this.options.apiKey;
    if (literal !== undefined && literal.length > 0) return literal;
    let resolved: string | undefined;
    try {
      resolved = await this.options.resolveApiKey?.();
    } catch (error: unknown) {
      if (isAbortError(error)) throw searchAborted(error);
      throw new WebError(
        `Ollama search credential resolution failed: ${String(error)}`,
        "WEB_PROVIDER_ERROR",
        {
          cause: error,
        },
      );
    }
    if (resolved !== undefined && resolved.length > 0) return resolved;
    throw new WebError(
      `Ollama search has no API key for "${this.options.apiKeyEnv}"; store it through the credentials service` +
        ' (the web Models page writes it), export it in the launching environment, or set a literal "apiKey"' +
        " in the web-search-ollama config",
      "WEB_PROVIDER_CREDENTIAL_MISSING",
    );
  }
}

function clampMaxResults(maxResults: number | undefined): number | undefined {
  if (maxResults === undefined) return undefined;
  return Math.min(maxResults, OLLAMA_MAX_RESULTS_LIMIT);
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function searchAborted(cause: unknown): WebError {
  return new WebError("Ollama search aborted", "WEB_ABORTED", { cause });
}
