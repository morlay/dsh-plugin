import { Context } from "@deepseek-ai/cordis";
import WebRuntime from "@deepseek-ai/dsh-web";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as plugin from "../index.ts";
import {
  mapOllamaResponse,
  mapOllamaResult,
  OLLAMA_PROVIDER_ID,
  OllamaSearchProvider,
} from "../provider.ts";

const options = {
  apiKey: "ollama-key",
  apiKeyEnv: "OLLAMA_API_KEY",
  baseURL: "https://ollama.test",
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Ollama 结果映射", () => {
  it("映射一条完整结果", () => {
    expect(
      mapOllamaResult({
        title: "Ollama",
        url: "https://ollama.com/",
        content: "Cloud models are now available...",
      }),
    ).toEqual({
      url: "https://ollama.com/",
      title: "Ollama",
      snippet: "Cloud models are now available...",
    });
  });

  it("content 为空时保留 url，只是不给 snippet", () => {
    expect(mapOllamaResult({ title: "Ollama", url: "https://ollama.com/", content: "" })).toEqual({
      url: "https://ollama.com/",
      title: "Ollama",
    });
  });

  it("没有 url 的条目丢掉（seam 的 source 必须有 url）", () => {
    expect(mapOllamaResult({ title: "Ollama", content: "hi" })).toBeUndefined();
    expect(mapOllamaResult({ url: "", content: "hi" })).toBeUndefined();
  });

  it("results 缺失时给出空结果", () => {
    expect(mapOllamaResponse({})).toEqual({ sources: [], truncated: false });
  });

  it("结果数组里的非法条目被丢掉，其余照常", () => {
    expect(
      mapOllamaResponse({
        results: [
          { url: "https://a.test", content: "a" },
          { title: "no url" },
          { url: "https://b.test" },
        ],
      }),
    ).toEqual({
      sources: [{ url: "https://a.test", snippet: "a" }, { url: "https://b.test" }],
      truncated: false,
    });
  });
});

describe("OllamaSearchProvider 可用性", () => {
  it("没有 key 也没有解析入口时不可用", () => {
    expect(
      new OllamaSearchProvider({
        apiKeyEnv: "OLLAMA_API_KEY",
        baseURL: options.baseURL,
      }).available(),
    ).toBe(false);
  });

  it("有字面 key 时可用", () => {
    expect(new OllamaSearchProvider(options).available()).toBe(true);
  });

  it("只有解析入口（凭证在运行期才能取到）时也算可用", () => {
    expect(
      new OllamaSearchProvider({
        apiKeyEnv: "OLLAMA_API_KEY",
        baseURL: options.baseURL,
        resolveApiKey: async () => "ollama-key",
      }).available(),
    ).toBe(true);
  });

  it("baseURL 解析不了时不可用", () => {
    expect(new OllamaSearchProvider({ ...options, baseURL: "not a url" }).available()).toBe(false);
  });
});

describe("OllamaSearchProvider 请求映射", () => {
  it("发 query 与 max_results，带 bearer 授权", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ results: [{ url: "https://a.test", content: "a" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await new OllamaSearchProvider(options).search({ query: "what is ollama?", maxResults: 8 });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://ollama.test/api/web_search");
    expect(init).toMatchObject({ method: "POST", redirect: "error" });
    expect((init.headers as Record<string, string>)["authorization"]).toBe("Bearer ollama-key");
    expect(JSON.parse(init.body as string)).toEqual({ query: "what is ollama?", max_results: 8 });
  });

  it("请求没给 maxResults 时用配置里的默认值", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await new OllamaSearchProvider({ ...options, maxResults: 3 }).search({ query: "q" });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ max_results: 3 });
  });

  it("请求的 maxResults 压过配置默认值", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await new OllamaSearchProvider({ ...options, maxResults: 3 }).search({
      query: "q",
      maxResults: 7,
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ max_results: 7 });
  });

  it("超过 Ollama 自己上限的 max_results 被压到 10", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await new OllamaSearchProvider({ ...options, maxResults: 50 }).search({
      query: "q",
      maxResults: 50,
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ max_results: 10 });
  });

  it("把取消信号透传给 fetch", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await new OllamaSearchProvider(options).search({ query: "q" }, controller.signal);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });

  it("用解析入口取到的 key", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await new OllamaSearchProvider({
      apiKeyEnv: "OLLAMA_API_KEY",
      baseURL: options.baseURL,
      resolveApiKey: async () => "resolved-key",
    }).search({ query: "q" });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["authorization"]).toBe("Bearer resolved-key");
  });
});

describe("OllamaSearchProvider 错误处理", () => {
  it("HTTP 错误映射成 WEB_PROVIDER_ERROR，并带上 Ollama 的说明", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "invalid api key" }, { status: 401 })),
    );

    await expect(new OllamaSearchProvider(options).search({ query: "q" })).rejects.toThrow(
      expect.objectContaining({ code: "WEB_PROVIDER_ERROR", message: "invalid api key" }),
    );
  });

  it("错误体不是 JSON 时保留状态行信息", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("gateway down", { status: 502 })),
    );

    await expect(new OllamaSearchProvider(options).search({ query: "q" })).rejects.toThrow(
      expect.objectContaining({
        code: "WEB_PROVIDER_ERROR",
        message: "Ollama API error (HTTP 502)",
      }),
    );
  });

  it("网络失败映射成 WEB_PROVIDER_ERROR", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("connection refused"))),
    );

    await expect(new OllamaSearchProvider(options).search({ query: "q" })).rejects.toThrow(
      expect.objectContaining({ code: "WEB_PROVIDER_ERROR" }),
    );
  });

  it("取消映射成 WEB_ABORTED", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new DOMException("aborted", "AbortError"))),
    );

    await expect(new OllamaSearchProvider(options).search({ query: "q" })).rejects.toThrow(
      expect.objectContaining({ code: "WEB_ABORTED" }),
    );
  });

  it("成功体解析不了时映射成 WEB_PROVIDER_ERROR", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not json", { status: 200 })),
    );

    await expect(new OllamaSearchProvider(options).search({ query: "q" })).rejects.toThrow(
      expect.objectContaining({ code: "WEB_PROVIDER_ERROR" }),
    );
  });

  it("results 形状不对时映射成 WEB_PROVIDER_ERROR，而不是裸 TypeError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ results: {} }, { status: 200 })),
    );

    await expect(new OllamaSearchProvider(options).search({ query: "q" })).rejects.toThrow(
      expect.objectContaining({ code: "WEB_PROVIDER_ERROR" }),
    );
  });

  it("取不到 key 时点名凭证引用，而不是发一个无授权请求", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new OllamaSearchProvider({
        apiKeyEnv: "OLLAMA_API_KEY",
        baseURL: options.baseURL,
        resolveApiKey: async () => undefined,
      }).search({ query: "q" }),
    ).rejects.toThrow(expect.objectContaining({ code: "WEB_PROVIDER_CREDENTIAL_MISSING" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("web-search-ollama 插件装配", () => {
  it("把 provider 注册进 ctx.web，dispose 后随之消失", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ results: [{ url: "https://a.test", content: "a" }] })),
    );
    const ctx = new Context();
    await ctx.plugin(WebRuntime, { searchProvider: OLLAMA_PROVIDER_ID });
    const fiber = await ctx.plugin(plugin, { apiKey: "ollama-key" });

    await expect(ctx.web.search({ query: "q" })).resolves.toMatchObject({
      sources: [{ url: "https://a.test", snippet: "a" }],
      truncated: false,
    });

    await fiber.dispose();
    await expect(ctx.web.search({ query: "q" })).rejects.toThrow(
      expect.objectContaining({ code: "WEB_PROVIDER_CONFIGURED_MISSING" }),
    );
  });

  it("把 config 的端点与默认结果数带进请求", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const ctx = new Context();
    await ctx.plugin(WebRuntime, { searchProvider: OLLAMA_PROVIDER_ID });
    await ctx.plugin(plugin, {
      apiKey: "ollama-key",
      baseURL: "https://ollama.proxy.test",
      maxResults: 2,
    });

    await ctx.web.search({ query: "q" });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://ollama.proxy.test/api/web_search");
    expect(JSON.parse(init.body as string)).toMatchObject({ max_results: 2 });
  });

  it("是命名空间插件（没有 default 导出）", () => {
    expect("default" in plugin).toBe(false);
  });
});
