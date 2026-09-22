import { Context } from "@deepseek-ai/cordis";
import WebRuntime from "@deepseek-ai/dsh-web";
import { describe, expect, it } from "vitest";
import * as plugin from "../src/index.ts";
import { OLLAMA_PROVIDER_ID, OllamaSearchProvider } from "../src/provider.ts";

/**
 * 真打 `https://ollama.com/api/web_search` 的 e2e。**刻意放在 `src/__tests__/` 之外**：
 * 根 `vitest.config.ts` 的 include 只收 `packages/**\/src/__tests__/`，所以默认的 `just test` 不会收集它——
 * 免得环境里恰好有 `OLLAMA_API_KEY` 时，全量测试静悄悄打外网、花额度、还看运气。
 *
 * 触发方式与跳过条件见包层规范 [`.agents/standards/how-to-verify.md`](../.agents/standards/how-to-verify.md)。
 */
const API_KEY = process.env["OLLAMA_API_KEY"] ?? "";

describe.skipIf(API_KEY.length === 0)("Ollama /api/web_search（真实端点）", () => {
  it("对一条查询拿回可引用的 sources", async () => {
    const provider = new OllamaSearchProvider({
      apiKey: API_KEY,
      apiKeyEnv: "OLLAMA_API_KEY",
      baseURL: "https://ollama.com",
      maxResults: 3,
    });

    const result = await provider.search({ query: "cordis plugin framework", maxResults: 3 });

    expect(result.truncated).toBe(false);
    expect(result.sources.length).toBeGreaterThan(0);
    for (const source of result.sources) {
      expect(source.url).toMatch(/^https?:\/\//);
    }
  }, 60_000);

  it("装进 ctx.web 后，选中这个后端的一次搜索也拿得回结果", async () => {
    const ctx = new Context();
    await ctx.plugin(WebRuntime, { searchProvider: OLLAMA_PROVIDER_ID });
    await ctx.plugin(plugin, { apiKey: API_KEY });

    const result = await ctx.web.search({ query: "deepseek harness plugin" });

    expect(result.sources.length).toBeGreaterThan(0);
  }, 60_000);
});
