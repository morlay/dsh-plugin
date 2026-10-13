import { defineConfig } from "tsdown";
import { cordisPlugin } from "@local/tsdown-plugin-cordis";

// 能力包：`rows` 出口发布装配数据（行清单），行本身由部署那层装（`packages/bundles/*` 里引用它渲染 patch）。
export default defineConfig({
  entry: { rows: "./src/rows.ts" },
  plugins: [cordisPlugin()],
});
