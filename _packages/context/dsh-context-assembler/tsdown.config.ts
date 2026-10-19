import { defineConfig } from "tsdown";
import { cordisPlugin } from "@local/tsdown-plugin-cordis";

// 两个出口：包根是通道本体（装配行写包名就装到它），`rows` 只出行清单（装配入口在部署那一层——
// `packages/bundles/session-mode-profile` 直接 import 它渲染 patch，于是行清单只有一份真源）。
export default defineConfig({
  entry: {
    "cordis-register": "./src/cordis-register.ts",
    index: "./src/index.ts",
    rows: "./src/rows.ts",
    testing: "./src/testing.ts",
  },
  plugins: [cordisPlugin()],
});
