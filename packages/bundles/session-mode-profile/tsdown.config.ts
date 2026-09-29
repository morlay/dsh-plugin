import { defineCordisPluginConfig } from "@local/devkit";
import { bundlePatch, renderPatch, type PatchBundleOptions } from "@local/devkit/patch";
import { defineConfig } from "tsdown";
import { TOOLKIT_PRESET_ROWS, toolGuidanceRow } from "@morlay/dsh-agent-toolkit/rows";
import { contextChannel, scopeRow } from "@morlay/dsh-context-assembler/rows";
import { MODE_PRESET_ID, sessionModeRows } from "@morlay/dsh-session-mode/rows";
import { subagentRows } from "@morlay/dsh-subagent/rows";

// 本部署自己注册的 agent preset：两个会话模式共享它，差异由会话级收口表达。行清单直接引用工具包的
// `TOOLKIT_PRESET_ROWS`，`tool-guidance` 不在其中（属于 host 平面）。`order` 取 5（官方四个 shipped preset 占 1..4）。
// 取舍见 `./.agents/adrs/20260929-自己注册preset.md`。
const PRESET_ROW = {
  id: `preset-${MODE_PRESET_ID}`,
  name: "@deepseek-ai/dsh-agent-preset",
  config: {
    id: MODE_PRESET_ID,
    name: "手动切换模式",
    description:
      "本部署的行清单：两个会话模式共享它，差异由会话级收口（提示词 / 工具白名单 / 注入开关）决定。",
    order: 5,
    plugins: TOOLKIT_PRESET_ROWS,
  },
};

export const ROWS: readonly unknown[] = [
  // 共享 client 行：本 bundle 的 client 半 inject 它们。**同 id 重复插入是幂等的**——Loader 对同 id
  // 复用同一个 Entry（后者胜），所以每个 bundle 都插齐自己需要的那几行，单独装也能用。
  {
    insert: [{ id: "ui-primitives-fork", name: "@morlay/dsh-client-ui-primitives" }],
  },
  // preset 声明排在模式行之前：模式里的 `preset` 指的是它。
  { insert: [PRESET_ROW] },
  ...sessionModeRows(),
  // 接管官方 `subagent` 行（同 id 复用换实现，官方设置卡照常可用）；中文回报指引只给挂我们这份 preset 的会话。
  ...subagentRows({ localizedReturnGuidancePresets: [MODE_PRESET_ID] }),
  {
    // 通道 + 两条注入面：工作区指令在 preset 自带上游那行时让位，skill 面反过来由通道抢。
    // 取舍见 `packages/context/dsh-context-assembler/.agents/adrs/20260929-工作区指令让位skill面由通道抢面.md`。
    insert: [
      contextChannel({
        capabilities: ["assembler", "agent-instructions", "skill-catalog"],
      }),
    ],
  },
  { insert: [scopeRow()] },
  { insert: [toolGuidanceRow()] },
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
