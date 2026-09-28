import { defineCordisPluginConfig } from "@local/devkit";
import { bundlePatch, renderPatch, type PatchBundleOptions } from "@local/devkit/patch";
import { defineConfig } from "tsdown";

const ROWS: readonly unknown[] = [
  { id: "locale", config: { preference: "zh" } },
  // 新会话默认挂本部署自己的 preset（`bundles/session-mode-profile` 声明的那份，两个模式共享）：
  // 于是"选模式"通常不需要换 preset，只有用户显式去官方 roster 选 standard 之类才走换 preset 那条路。
  // 值是字面量、不与 session-mode 包耦合（本 bundle 是纯值层）；两处一致由 session-mode-profile 的
  // patch 测试钉住。
  { id: "agent-preset-registry", config: { default: "mode-switch" } },
  // 首次引导预置成"已确认"：桌面 client 不是 loopback，上游把 settings 的持久化降级成 memory，
  // "确认过"只活在当前页面进程里，每次打开都弹。上游 bump 版本后值不再相等，会照常再弹一次（符合语义）。
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
