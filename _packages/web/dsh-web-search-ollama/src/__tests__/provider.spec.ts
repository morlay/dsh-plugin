// Ollama 搜索后端的对外行为：发什么请求、把响应映射成什么、什么时候不可用、失败报什么码。
// 全部经公开面（`search()` / `available()`）验证，不直测内部映射函数。

import { describe, expect, it, vi } from "vitest";
import { OllamaSearchProvider, type OllamaSearchProviderOptions } from "../provider.ts";

const options = {
  apiKey: "ollama-key",
  apiKeyEnv: "OLLAMA_API_KEY",
  baseURL: "https://ollama.test",
};

// HTTP 是 provider 的可配置依赖（缺省全局 fetch），测试直接注入自己的实现。
function providerOf(
  fetchImpl: typeof fetch,
  overrides: Partial<OllamaSearchProviderOptions> = {},
): OllamaSearchProvider {
  return new OllamaSearchProvider({ ...options, fetch: fetchImpl, ...overrides });
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function requestOf(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit] {
  return fetchMock.mock.calls[0] as unknown as [string, RequestInit];
}

function headerOf(fetchMock: ReturnType<typeof vi.fn>, name: string): string | undefined {
  const [, init] = requestOf(fetchMock);
  return (init.headers as Record<string, string>)[name];
}

function bodyOf(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  return JSON.parse(requestOf(fetchMock)[1].body as string) as Record<string, unknown>;
}

describe("Ollama 搜索后端", () => {
  describe("请求", () => {
    it("发 query 与 max_results，带 bearer 授权", async () => {
      const fetchMock = vi.fn(async () =>
        jsonResponse({ results: [{ url: "https://a.test", content: "a" }] }),
      );

      await providerOf(fetchMock).search({ query: "what is ollama?", maxResults: 8 });

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(requestOf(fetchMock)[0]).toBe("https://ollama.test/api/web_search");
      expect(requestOf(fetchMock)[1]).toMatchObject({ method: "POST", redirect: "error" });
      expect(headerOf(fetchMock, "authorization")).toBe("Bearer ollama-key");
      expect(bodyOf(fetchMock)).toEqual({ query: "what is ollama?", max_results: 8 });
    });

    it("没给 maxResults 时用配置里的默认值", async () => {
      const fetchMock = vi.fn(async () => jsonResponse({ results: [] }));

      await providerOf(fetchMock, { maxResults: 3 }).search({ query: "q" });

      expect(bodyOf(fetchMock)).toMatchObject({ max_results: 3 });
    });

    it("请求的 maxResults 压过配置默认值", async () => {
      const fetchMock = vi.fn(async () => jsonResponse({ results: [] }));

      await providerOf(fetchMock, { maxResults: 3 }).search({ query: "q", maxResults: 7 });

      expect(bodyOf(fetchMock)).toMatchObject({ max_results: 7 });
    });

    it("超过服务端上限的 max_results 被压到 10", async () => {
      const fetchMock = vi.fn(async () => jsonResponse({ results: [] }));

      await providerOf(fetchMock).search({ query: "q", maxResults: 50 });

      expect(bodyOf(fetchMock)).toMatchObject({ max_results: 10 });
    });

    it("把取消信号透传给 HTTP", async () => {
      const fetchMock = vi.fn(async () => jsonResponse({ results: [] }));
      const controller = new AbortController();

      await providerOf(fetchMock).search({ query: "q" }, controller.signal);

      expect(requestOf(fetchMock)[1].signal).toBe(controller.signal);
    });

    it("用运行期解析出来的 key", async () => {
      const fetchMock = vi.fn(async () => jsonResponse({ results: [] }));

      await providerOf(fetchMock, {
        apiKey: undefined,
        resolveApiKey: async () => "resolved-key",
      }).search({ query: "q" });

      expect(headerOf(fetchMock, "authorization")).toBe("Bearer resolved-key");
    });
  });

  describe("结果", () => {
    it("把 Ollama 的 results 映射成可引用的 sources", async () => {
      const fetchMock = vi.fn(async () =>
        jsonResponse({
          results: [
            { url: "https://a.test", title: "A", content: "a snippet" },
            { url: "https://b.test" },
          ],
        }),
      );

      await expect(providerOf(fetchMock).search({ query: "q" })).resolves.toEqual({
        sources: [
          { url: "https://a.test", title: "A", snippet: "a snippet" },
          { url: "https://b.test" },
        ],
        truncated: false,
      });
    });

    it("丢掉没有 url 的条目，空 content 不给 snippet", async () => {
      const fetchMock = vi.fn(async () =>
        jsonResponse({
          results: [
            { title: "no url", content: "x" },
            { url: "", content: "x" },
            { url: "https://a.test", content: "" },
          ],
        }),
      );

      await expect(providerOf(fetchMock).search({ query: "q" })).resolves.toEqual({
        sources: [{ url: "https://a.test" }],
        truncated: false,
      });
    });

    it("没有 results 时是空结果", async () => {
      const fetchMock = vi.fn(async () => jsonResponse({}));

      await expect(providerOf(fetchMock).search({ query: "q" })).resolves.toEqual({
        sources: [],
        truncated: false,
      });
    });
  });

  describe("可用性", () => {
    it("没有 key 也没有解析入口时不可用", () => {
      expect(
        new OllamaSearchProvider({ apiKeyEnv: "OLLAMA_API_KEY", baseURL: options.baseURL }).available(),
      ).toBe(false);
    });

    it("有字面 key 时可用", () => {
      expect(new OllamaSearchProvider(options).available()).toBe(true);
    });

    it("只有解析入口（key 在运行期才能取到）时也算可用", () => {
      expect(
        new OllamaSearchProvider({
          apiKeyEnv: "OLLAMA_API_KEY",
          baseURL: options.baseURL,
          resolveApiKey: async () => "ollama-key",
        }).available(),
      ).toBe(true);
    });

    it("端点不成 URL 时不可用", () => {
      expect(new OllamaSearchProvider({ ...options, baseURL: "not a url" }).available()).toBe(false);
    });
  });

  describe("失败", () => {
    it("HTTP 错误带上服务端的说明", async () => {
      const fetchMock = vi.fn(async () => jsonResponse({ error: "invalid api key" }, { status: 401 }));

      await expect(providerOf(fetchMock).search({ query: "q" })).rejects.toMatchObject({
        code: "WEB_PROVIDER_ERROR",
        message: "invalid api key",
      });
    });

    it("错误体不是 JSON 时保留状态行信息", async () => {
      const fetchMock = vi.fn(async () => new Response("gateway down", { status: 502 }));

      await expect(providerOf(fetchMock).search({ query: "q" })).rejects.toMatchObject({
        code: "WEB_PROVIDER_ERROR",
        message: "Ollama API error (HTTP 502)",
      });
    });

    it("网络失败报 WEB_PROVIDER_ERROR", async () => {
      const fetchMock = vi.fn(() => Promise.reject(new TypeError("connection refused")));

      await expect(providerOf(fetchMock).search({ query: "q" })).rejects.toMatchObject({
        code: "WEB_PROVIDER_ERROR",
      });
    });

    it("取消报 WEB_ABORTED", async () => {
      const fetchMock = vi.fn(() => Promise.reject(new DOMException("aborted", "AbortError")));

      await expect(providerOf(fetchMock).search({ query: "q" })).rejects.toMatchObject({
        code: "WEB_ABORTED",
      });
    });

    it("成功体解析不了时报 WEB_PROVIDER_ERROR，而不是抛裸 TypeError", async () => {
      const fetchMock = vi.fn(async () => new Response("not json", { status: 200 }));

      await expect(providerOf(fetchMock).search({ query: "q" })).rejects.toMatchObject({
        code: "WEB_PROVIDER_ERROR",
      });
    });

    it("results 形状不对时同样报 WEB_PROVIDER_ERROR", async () => {
      const fetchMock = vi.fn(async () => jsonResponse({ results: {} }));

      await expect(providerOf(fetchMock).search({ query: "q" })).rejects.toMatchObject({
        code: "WEB_PROVIDER_ERROR",
      });
    });

    it("取不到 key 时指明凭证引用，不发请求", async () => {
      const fetchMock = vi.fn(async () => jsonResponse({ results: [] }));

      await expect(
        providerOf(fetchMock, {
          apiKey: undefined,
          resolveApiKey: async () => undefined,
        }).search({ query: "q" }),
      ).rejects.toMatchObject({ code: "WEB_PROVIDER_CREDENTIAL_MISSING" });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
