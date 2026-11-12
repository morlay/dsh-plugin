import { defineConfig } from "tsdown";
import { cordisPlugin } from "@local/tsdown-plugin-cordis";
import { bundlePatch, renderPatch, type PatchBundleOptions } from "@local/devkit/patch";

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
  // 部署默认 preset 是 `ptc`（程序化工具调用）：新会话挂的就是它。用户级 `selectedDefault`
  // 仍优先于这里（registry 是 `selectedDefault ?? default`），本行只给部署默认值。
  { id: "agent-preset-registry", config: { default: "ptc" } },
  { id: "ui-chat", config: { transcriptView: "verbose" } },
  // 向官方 DeepSeek 请求携带的会话日志（`dsh_session_log`）默认关掉。
  { id: "session-log-deepseek", config: { enabled: false } },
  // Agent Teams 上游默认**关**：新根会话要在模型/推理菜单里手选「Use Agent Teams」才开。这里给部署默认
  // 打开，新会话（含普通 fork）在第一次模型步骤前就带上 Team 模式；已有的会话选择优先，resume 不套默认。
  // config 是**整块替换**上游 base bundle 给的那份，所以 `maxTasks` 要跟着写全；rc.1 的
  // `maxMembers` / `maxMessageBytes` / `disposalTimeoutMs` 已被上游移除，写进来会抛 `TEAM_INVALID_CONFIG`。
  { id: "agent-team", config: { maxTasks: 256, defaultEnabled: true } },
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
