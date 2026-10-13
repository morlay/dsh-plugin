import { defineConfig } from "tsdown";
import { cordisPlugin } from "@local/tsdown-plugin-cordis";

// 与上游 `apps/desktop-host` 同边界：`@deepseek-ai/*` 由部署自己的 `node_modules` 提供（`dependencies` /
// `peerDependencies` 里的包 tsdown 默认留着 external）。
// `webserver` 是可被 patch 行按相对路径加载的独立入口（`@deepseek-ai/dsh-host-webserver` 保持 external）；
// 产物落 `dist/` 且不产声明，所以走 devkit 时显式声明。
export default defineConfig({
  entry: {
    webserver: "./src/webserver.ts",
    wire: "./src/wire.ts",
    paths: "./src/paths.ts",
  },
  plugins: [cordisPlugin({
  // 产物落 `.js` 而不是 `.mjs`/`.cjs`：`config/desktop.cordis.patch.yml` 按 `../dist/webserver.js`
  // 这样的**路径**加载它们（patch 行只认路径，不认包出口）。
  fixedExtension: false,
  dts: false,
  })],
});
