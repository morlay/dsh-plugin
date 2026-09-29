import { defineCordisPluginConfig } from "@local/devkit";
import { defineConfig } from "tsdown";

// 能力包：`rows` 出口发布装配数据（行清单），行本身由部署那层装（`packages/bundles/*` 里引用它渲染 patch）。
export default defineConfig(async () => ({
  ...(await defineCordisPluginConfig({
    entries: { rows: "./src/rows.ts" },
  })),
}));
