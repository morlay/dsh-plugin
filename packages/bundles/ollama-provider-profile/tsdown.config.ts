import { defineConfig } from "tsdown";
import { cordisPlugin } from "@local/tsdown-plugin-cordis";
import { bundlePatch, renderPatch, type PatchBundleOptions } from "@local/devkit/patch";
import { webSearchRows } from "@morlay/dsh-web-search-ollama/rows";

const ROWS: readonly unknown[] = [
  // 基础面（`@morlay/dsh-client-ui-primitives`）随用到它的 client 行内联，不再单独插行。
  ...webSearchRows(),
  {
    id: "llm-pi-ai",
    config: {
      providers: {
        ollama: {
          apiKeyEnv: "OLLAMA_API_KEY",
          displayName: "Ollama Cloud",
          // Anthropic Messages 形态：Ollama 从 v0.14 起提供 `/v1/messages`（云端 `https://ollama.com`，
          // 本地 `http://localhost:11434`），SDK 自己追加 `/v1/messages`。
          //
          // 它的实现只覆盖 Messages 的一个子集：不支持 prompt caching、deferred tools 与 tool_choice，
          // 也不承诺把中途的 system 消息读成有效提示词——所以这里**不声明** `supportsMidConvo*`
          // 兼容项（保持每步全量声明工具、system 走顶层）。想拿 in-history 与按需工具的前缀缓存收益，
          // 用官方 `deepseek-official` 路由。
          api: "anthropic-messages",
          baseURL: "https://ollama.com",
          // 云端端点只认 `Authorization: Bearer`（`x-api-key` 单独不够）；key 缺失时留空头，让 pi-ai
          // 以 "No API key" 明确失败，而不是发一个空 Bearer。
          headers: {
            Authorization: {
              __jsExpr: "process.env.OLLAMA_API_KEY ? 'Bearer ' + process.env.OLLAMA_API_KEY : ''",
            },
          },
          reasoning: "high",
          // 图片上限按 llm-deepseek 的默认对齐：每张请求版本的原始字节目标 2 MiB（pi-ai 默认 1 MiB）。
          requestImageMaxBytes: 2 * 1024 * 1024,
          models: [
            {
              id: "deepseek-v4.1-flash:1017",
              name: "DeepSeek V4.1 Flash 1017 @ Ollama Cloud",
              contextWindow: 1000000,
              input: ["text", "image"],
              reasoningEfforts: {
                off: null,
                low: "low",
                high: "high",
                max: "max",
              },
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

// patch 真源：生成物是包根那份 `cordis.patch.yml`，build 时由插件重写。
export const patch: PatchBundleOptions = {
  from: import.meta.url,
  rows: () => ROWS,
};

// 渲染生成物文本（测试拿它与入库那份比对）。
export const render = (): Promise<string> => renderPatch(patch);

export default defineConfig({
  plugins: [cordisPlugin(), bundlePatch(patch)],
});
