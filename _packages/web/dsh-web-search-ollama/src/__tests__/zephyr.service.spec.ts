// 联网搜索后端对外表现：搜索能返回可引用的 sources、行配置用在请求上、key 按凭证服务→启动环境取，
// 以及不配任何额外依赖时开箱可用。请求/映射/错误码的细节在 `provider.spec.ts`。

import { Credentials, LaunchEnvironment, type LaunchEnvironmentSnapshot } from "@morlay/dsh-base/agent";
import { HttpFetch } from "@morlay/dsh-base/web";
import { WebDefault } from "@morlay/dsh-base/web";
import { bootstrapApplication, type App } from "@morlay/zephyr";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OLLAMA_PROVIDER_ID, WebSearchOllama } from "../index.ts";

const apps: App[] = [];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function fakeFetch() {
  return vi.fn(async () => jsonResponse({ results: [{ url: "https://a.test", content: "a" }] }));
}

function requestOf(fetchMock: ReturnType<typeof fakeFetch>): [string, RequestInit] {
  return fetchMock.mock.calls[0] as unknown as [string, RequestInit];
}

function headerOf(fetchMock: ReturnType<typeof fakeFetch>, name: string): string | undefined {
  const [, init] = requestOf(fetchMock);
  return (init.headers as Record<string, string>)[name];
}

// 测试替身：真实凭证服务要落盘，这里只关心「按引用名解析出什么值」。
function credentialsOf(value: string) {
  return { resolve: async () => ({ value }) } as unknown as InstanceType<typeof Credentials>;
}

function launchEnvironmentOf(values: Record<string, string>) {
  return {
    get: (name: string) => (values[name] === undefined ? undefined : { name, value: values[name] }),
    getFrom: () => undefined,
  } as unknown as LaunchEnvironmentSnapshot;
}

async function search(providers: Parameters<typeof bootstrapApplication>[0]["providers"]) {
  const app = await bootstrapApplication({
    providers: [
      WebDefault.withConfig({ searchProvider: OLLAMA_PROVIDER_ID }),
      ...(Array.isArray(providers) ? providers : [providers]),
    ],
    timeoutMs: 5000,
  });
  apps.push(app);
  return app.get(WebDefault).search({ query: "cordis plugin framework" });
}

afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose();
});

describe("联网搜索后端", () => {
  it("搜索返回可引用的 sources", async () => {
    const fetchMock = fakeFetch();

    await expect(
      search([
        { provide: HttpFetch, useFactory: () => fetchMock },
        WebSearchOllama.withConfig({ apiKey: "ollama-key" }),
      ]),
    ).resolves.toEqual({
      sources: [{ url: "https://a.test", snippet: "a" }],
      truncated: false,
    });
  });

  it("行配置的端点用在请求上", async () => {
    const fetchMock = fakeFetch();

    await search([
      { provide: HttpFetch, useFactory: () => fetchMock },
      WebSearchOllama.withConfig({ apiKey: "ollama-key", baseURL: "https://ollama.proxy.test" }),
    ]);

    expect(requestOf(fetchMock)[0]).toBe("https://ollama.proxy.test/api/web_search");
  });

  it("key 来自凭证服务", async () => {
    const fetchMock = fakeFetch();

    await search([
      { provide: HttpFetch, useFactory: () => fetchMock },
      { provide: Credentials, useFactory: () => credentialsOf("credential-key") },
      WebSearchOllama.withConfig({ apiKeyEnv: "OLLAMA_API_KEY" }),
    ]);

    expect(headerOf(fetchMock, "authorization")).toBe("Bearer credential-key");
  });

  it("没有凭证服务时用启动环境里的 key", async () => {
    const fetchMock = fakeFetch();

    await search([
      { provide: HttpFetch, useFactory: () => fetchMock },
      { provide: LaunchEnvironment, useFactory: () => launchEnvironmentOf({ OLLAMA_API_KEY: "env-key" }) },
      WebSearchOllama.withConfig({ apiKeyEnv: "OLLAMA_API_KEY" }),
    ]);

    expect(headerOf(fetchMock, "authorization")).toBe("Bearer env-key");
  });

  it("取不到 key 时指明去哪里配，不发请求", async () => {
    const fetchMock = fakeFetch();

    await expect(
      search([
        { provide: HttpFetch, useFactory: () => fetchMock },
        WebSearchOllama.withConfig({ apiKeyEnv: "OLLAMA_API_KEY" }),
      ]),
    ).rejects.toMatchObject({ code: "WEB_PROVIDER_CREDENTIAL_MISSING" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("不配额外的 HTTP 执行器时也开箱可用", async () => {
    // 端口 1 上没有服务：只有真的走到全局 fetch 才会拿到网络失败。
    await expect(
      search(
        WebSearchOllama.withConfig({ apiKey: "ollama-key", baseURL: "http://127.0.0.1:1" }),
      ),
    ).rejects.toMatchObject({ code: "WEB_PROVIDER_ERROR" });
  });
});
