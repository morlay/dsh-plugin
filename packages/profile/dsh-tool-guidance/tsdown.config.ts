import { defineCordisPluginConfig } from "@local/devkit";
import { defineConfig } from "tsdown";

// 说明包：包根（`index`）就是工具说明运行时，`rows` 出口发布工具说明那一行
// （`packages/bundles/session-mode-profile` 的 host 平面引用它）。
export default defineConfig(async () => ({
  ...(await defineCordisPluginConfig({
    entries: {
      index: "./src/index.ts",
      rows: "./src/rows.ts",
    },
  })),
}));
