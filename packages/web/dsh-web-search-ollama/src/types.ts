/**
 * POST https://ollama.com/api/web_search 的 wire 类型。只有类型，没有运行期代码。
 *
 * 响应是扁平 `results[]`，每条带 title / url / content；`content` 是 Ollama 自己截出来的
 * 网页片段（不是生成式答案），所以它只映射到 `WebSearchSource.snippet`。
 */

/** 请求体。`max_results` 缺省时由服务端按自己的默认值（5）处理。 */
export interface OllamaSearchRequest {
  query: string;
  max_results?: number;
}

/** `results[]` 的一条；字段都可能缺失或为空串。 */
export interface OllamaSearchResult {
  title?: string | null;
  url?: string | null;
  content?: string | null;
}

/** 成功响应信封。 */
export interface OllamaSearchResponse {
  results?: OllamaSearchResult[];
}

/** 错误响应信封；Ollama 失败时给 `{"error": "..."}`。 */
export interface OllamaError {
  error?: string;
}
