import { defineCordisPluginConfig } from "@local/devkit";
import { defineConfig } from "tsdown";

/**
 * 说明包：`rows` 出口发布工具名与工具说明行（`bundles/session-mode-profile` 引用它渲染 patch）。
 */
export default defineConfig(async () => ({
  ...(await defineCordisPluginConfig({
    entries: {
      rows: "./src/rows.ts",
      guidance: "./src/guidance/index.ts",
      "agent-team": "./src/agent-team.ts",
    },
  })),
}));
