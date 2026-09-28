import { defineCordisPluginConfig } from "@local/devkit";
import { bundlePatch, renderPatch, type PatchBundleOptions } from "@local/devkit/patch";
import { defineConfig } from "tsdown";
import { webSearchRows } from "@morlay/dsh-web-search-ollama/rows";

const ROWS: readonly unknown[] = [
  // 共享 client 行：本 bundle 的 client 半 inject 它们。**同 id 重复插入是幂等的**——Loader 对同 id
  // 复用同一个 Entry（后者胜），所以每个 bundle 都插齐自己需要的那几行，单独装也能用。
  { insert: [{ id: "ui-primitives-fork", name: "@morlay/dsh-client-ui-primitives" }] },
  ...webSearchRows(),
  {
    id: "llm-pi-ai",
    config: {
      providers: {
        ollama: {
          apiKeyEnv: "OLLAMA_API_KEY",
          displayName: "Ollama Cloud",
          api: "openai-completions",
          baseURL: "https://ollama.com/v1",
          reasoning: "high",
          // 图片上限按 llm-deepseek 的默认对齐：每张请求版本的原始字节目标 2 MiB（pi-ai 默认 1 MiB）。
          requestImageMaxBytes: 2 * 1024 * 1024,
          models: [
            {
              id: "deepseek-v4.1-flash",
              name: "DeepSeek V4.1 Flash @ Ollama Cloud",
              contextWindow: 1000000,
              input: ["text", "image"],
              reasoningEfforts: { off: null, low: "low", high: "high", max: "max" },
            },
          ],
        },
      },
    },
  },
  // config 是整体替换、不是深合并——`fetchProvider` 必须跟着写全。
  { id: "web", config: { searchProvider: "ollama", fetchProvider: "http" } },
  { id: "web-search-ollama", config: { apiKeyEnv: "OLLAMA_API_KEY" } },
];

/** patch 真源：生成物是包根那份 `cordis.patch.yml`，build 时由插件重写。 */
export const patch: PatchBundleOptions = {
  from: import.meta.url,
  rows: () => ROWS,
};

/** 渲染生成物文本（测试拿它与入库那份比对）。 */
export const render = (): Promise<string> => renderPatch(patch);

export default defineConfig(async () => {
  const base = await defineCordisPluginConfig();
  const plugins = Array.isArray(base.plugins)
    ? [...base.plugins, bundlePatch(patch)]
    : [bundlePatch(patch)];
  return { ...base, plugins };
});
