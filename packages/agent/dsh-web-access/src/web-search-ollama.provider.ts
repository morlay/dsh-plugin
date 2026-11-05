// Ollama 的搜索后端（`POST https://ollama.com/api/web_search`）：纯逻辑 + `fetch`，不碰 cordis。
//
// 与上游 `dsh-plugin-main/packages/web/dsh-web-search-ollama` 的实现同形；我们的仓库没有那个包，
// 这里按 `WebSearchProvider` 契约直接写一份，接线在 `web-search-ollama.service.ts`。
import {
  WebError,
  type WebSearchProvider,
  type WebSearchRequest,
  type WebSearchResult,
  type WebSearchSource,
} from "./web.service.ts";

/** 注册进 `ctx.web` 的 id；与 llm route 同名，配置里看到的就是同一个 "ollama"。 */
export const OLLAMA_PROVIDER_ID = "ollama";

/** 默认端点；`/api/web_search` 是操作。 */
export const OLLAMA_DEFAULT_BASE_URL = "https://ollama.com";

/** Ollama `max_results` 的硬上限；超过它的值不发给服务端。 */
export const OLLAMA_MAX_RESULTS_LIMIT = 10;

/** 每次请求带的归属头。 */
const USER_AGENT = "morlay-dsh-plugin/0.0.1";

/** `POST /api/web_search` 的一条结果；字段都可能缺失或为空串。 */
interface OllamaSearchResult {
  readonly title?: string | null;
  readonly url?: string | null;
  readonly content?: string | null;
}

/** 成功信封。 */
interface OllamaSearchResponse {
  readonly results?: readonly OllamaSearchResult[];
}

/** 失败信封（Ollama 给 `{ "error": "…" }`）。 */
interface OllamaError {
  readonly error?: string;
}

/** 构造参数。 */
export interface OllamaSearchProviderOptions {
  /** 字面 key；给了就压过 `apiKeyEnv`。 */
  readonly apiKey?: string | undefined;
  /** 取不到 key 时报出来的变量名，便于用户知道去哪配。 */
  readonly apiKeyEnv: string;
  /** 端点根。 */
  readonly baseURL: string;
  /** 请求没带 `maxResults` 时的默认值；省略表示让 Ollama 用自己的默认。 */
  readonly maxResults?: number | undefined;
}

/**
 * 一条 Ollama 结果 → 一个 source；没有 url 就丢掉（seam 的 source 必须有 url）。
 * @param result - Ollama 的一条结果。
 * @returns 归一化的 source，或 `undefined`。
 */
export function mapOllamaResult(result: OllamaSearchResult): WebSearchSource | undefined {
  const url = result.url;
  if (typeof url !== "string" || url.length === 0) return undefined;
  const title = typeof result.title === "string" && result.title.length > 0 ? result.title : undefined;
  const snippet = typeof result.content === "string" && result.content.length > 0 ? result.content : undefined;
  return {
    url,
    ...(title === undefined ? {} : { title }),
    ...(snippet === undefined ? {} : { snippet }),
  };
}

/**
 * 响应信封 → 归一化结果；形状不对就抛（由调用方包成 `WEB_PROVIDER_ERROR`）。
 * @param response - Ollama 的响应体。
 * @returns 归一化结果。
 */
export function mapOllamaResponse(response: OllamaSearchResponse): WebSearchResult {
  const results = response.results;
  if (results !== undefined && !Array.isArray(results)) {
    throw new TypeError("Ollama returned a non-array `results` field");
  }
  const sources = (results ?? [])
    .map((result) => mapOllamaResult(result))
    .filter((source): source is WebSearchSource => source !== undefined);
  // Ollama 不返回生成式答案（`content` 是每条结果的网页片段），所以没有 `result.content`；
  // 截断由 seam 负责，这里照实报 false。
  return { sources, truncated: false };
}

/** Ollama 的搜索后端。 */
export class OllamaSearchProvider implements WebSearchProvider {
  readonly id = OLLAMA_PROVIDER_ID;

  constructor(private readonly options: OllamaSearchProviderOptions) {}

  available(): boolean {
    return (
      this.apiKeyOf() !== undefined &&
      URL.canParse(this.options.baseURL) &&
      (this.options.maxResults === undefined || isPositiveInteger(this.options.maxResults))
    );
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const apiKey = this.apiKey();
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
      throw new WebError(`Ollama search request failed: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
    }

    if (!response.ok) {
      let message = `Ollama API error (HTTP ${String(response.status)})`;
      try {
        const parsed = (await response.json()) as OllamaError;
        const detail = parsed.error;
        if (typeof detail === "string" && detail.length > 0) message = detail;
      } catch (error: unknown) {
        // 取消不能吞成"HTTP 错误"：取消是 seam 的取消契约，不是 provider 故障。
        if (isAbortError(error)) throw searchAborted(error);
      }
      throw new WebError(message, "WEB_PROVIDER_ERROR");
    }

    try {
      return mapOllamaResponse((await response.json()) as OllamaSearchResponse);
    } catch (error: unknown) {
      if (isAbortError(error)) throw searchAborted(error);
      throw new WebError(`Ollama returned an unprocessable response body: ${String(error)}`, "WEB_PROVIDER_ERROR", {
        cause: error,
      });
    }
  }

  /**
   * 这次的 key：字面值优先，其次按 `apiKeyEnv` 读环境。
   * @returns key，取不到就是 `undefined`。
   */
  private apiKeyOf(): string | undefined {
    const literal = this.options.apiKey;
    if (literal !== undefined && literal.length > 0) return literal;
    const fromEnv = process.env[this.options.apiKeyEnv];
    return fromEnv === undefined || fromEnv.length === 0 ? undefined : fromEnv;
  }

  /**
   * 取 key；取不到就点名变量，而不是发一个无授权请求。
   * @returns key。
   * @throws `WEB_PROVIDER_CREDENTIAL_MISSING`。
   */
  private apiKey(): string {
    const key = this.apiKeyOf();
    if (key === undefined) {
      throw new WebError(
        `Ollama search has no API key for "${this.options.apiKeyEnv}"; export it in the launching environment` +
          ' or set a literal "apiKey" in the web-search-ollama config',
        "WEB_PROVIDER_CREDENTIAL_MISSING",
      );
    }
    return key;
  }
}

/**
 * 把结果数夹到服务端上限。
 * @param maxResults - 请求或配置给的值。
 * @returns 夹过之后的值。
 */
function clampMaxResults(maxResults: number | undefined): number | undefined {
  return maxResults === undefined ? undefined : Math.min(maxResults, OLLAMA_MAX_RESULTS_LIMIT);
}

/** @returns 是不是正整数。 */
function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

/** @returns 是不是取消。 */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** @returns 取消语义的错误（seam 按 code 分流）。 */
function searchAborted(cause: unknown): WebError {
  return new WebError("Ollama search aborted", "WEB_ABORTED", { cause });
}
