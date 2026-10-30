import { defineConfig } from "tsdown";
import { cordisPlugin } from "@local/tsdown-plugin-cordis";
import { bundlePatch, renderPatch, type PatchBundleOptions } from "@local/devkit/patch";
import { agentPresetRows } from "./src/presets.ts";

export const ROWS: readonly unknown[] = [
  { id: "locale", config: { preference: "zh" } },
  {
    id: "ui-settings-general",
    config: { welcomeNoticeVersion: "2026-09-28.1" },
  },
  {
    id: "agent-default-model",
    config: {
      provider: "ollama",
      model: "deepseek-v4.1-flash:1017",
      reasoningEffort: "high",
    },
  },
  { id: "ui-chat", config: { transcriptView: "verbose" } },
  // 向官方 DeepSeek 请求携带的会话日志（`dsh_session_log`）默认关掉。
  { id: "session-log-deepseek", config: { enabled: false } },
  // 四份 shipped preset 由本包统一声明：复制上游原文件，只删掉与 agent-team 冲突的子代理工具行。
  ...agentPresetRows(),
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
