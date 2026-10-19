import { defineConfig } from "tsdown";
import { cordisPlugin } from "@local/tsdown-plugin-cordis";

// 与 [`@morlay/dsh-desktop-host`](../../desktop/dsh-desktop-host/tsdown.config.ts) 同边界：`@deepseek-ai/*`
// 由部署自己的 `node_modules` 提供（声明在 dependencies / peerDependencies 里，tsdown 默认留作 external）。
export default defineConfig({
  entry: {
    index: "./src/index.ts",
  },
  plugins: [cordisPlugin()],
});
