import { defineCordisPluginConfig } from "@local/devkit";
import { bundlePatch, renderPatch, type PatchBundleOptions } from "@local/devkit/patch";
import { defineConfig } from "tsdown";

const ROWS: readonly unknown[] = [
  { id: "locale", config: { preference: "zh" } },
  {
    id: "ui-settings-general",
    config: { welcomeNoticeVersion: "2026-08-13.1" },
  },
  {
    id: "agent-default-model",
    config: {
      provider: "ollama",
      model: "deepseek-v4.1-flash",
      reasoningEffort: "high",
    },
  },
  { id: "ui-chat", config: { transcriptView: "verbose" } },
  // 向官方 DeepSeek 请求携带的会话日志（`dsh_session_log`）默认关掉。
  { id: "session-log-deepseek", config: { enabled: false } },
];

// patch 真源：生成物是包根那份 `cordis.patch.yml`，build 时由插件重写。
export const patch: PatchBundleOptions = {
  from: import.meta.url,
  rows: () => ROWS,
};

// 渲染生成物文本（测试拿它与入库那份比对）。
export const render = (): Promise<string> => renderPatch(patch);

export default defineConfig(async () => {
  const base = await defineCordisPluginConfig();
  const plugins = Array.isArray(base.plugins)
    ? [...base.plugins, bundlePatch(patch)]
    : [bundlePatch(patch)];
  return { ...base, plugins };
});
