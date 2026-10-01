import { defineCordisPluginConfig } from "@local/devkit";
import { bundlePatch, renderPatch, type PatchBundleOptions } from "@local/devkit/patch";
import { defineConfig } from "tsdown";
import { toolGuidanceRow } from "@morlay/dsh-tool-guidance/rows";
import { contextChannel } from "@morlay/dsh-context-assembler/rows";
import { sessionModeRows } from "@morlay/dsh-session-mode/rows";
import { subagentRows } from "@morlay/dsh-subagent/rows";

// 本部署**不再声明自己的 agent preset**：行清单（工具 / 命令 / 压缩 / 计划模式 / 委派）归会话挂着的 shipped
// preset（registry 的 `default` 由官方 web-app 给，`standard`），模式是叠加在它之上的会话级扩展——本 bundle 只装
// host 平面那几行。取舍与代价见 `./.agents/adrs/20260929-不再持有行清单.md`。
export const ROWS: readonly unknown[] = [
  // 基础面（`@morlay/dsh-client-ui-primitives`）随用到它的 client 行（`dsh-session-mode` 就是其一）内联，
  // 不再单独插行——所以这里只有本 bundle 自己要装的那几行。
  ...sessionModeRows(),
  // 接管官方 `subagent` 行（同 id 复用换实现，官方设置卡照常可用）：中文回报指引**不限制 preset**
  // （不配名单 = 官方四个 shipped 与还没绑 preset 的会话都用中文），所以这里不传 `localizedReturnGuidancePresets`。
  ...subagentRows(),
  {
    // 注入通道（只装通道本体）：工作区指令与技能目录走**官方行**（会话挂着的 shipped preset 自带
    // `@deepseek-ai/dsh-agent-instructions` 与 `@deepseek-ai/dsh-tool-skill`），本包只做装配结果上的文本转换。
    // 按会话收口（工具名单与三个注入开关）归 `session-mode` 行自己，不需要单独一行。
    insert: [contextChannel()],
  },
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
