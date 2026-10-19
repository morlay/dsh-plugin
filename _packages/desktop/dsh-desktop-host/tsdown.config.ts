import { defineConfig } from "tsdown";
import { cordisPlugin } from "@local/tsdown-plugin-cordis";

// 与上游 `apps/desktop-host` 同边界：`@deepseek-ai/*` 由部署自己的 `node_modules` 提供（`dependencies` /
// `peerDependencies` 里的包 tsdown 默认留着 external）。
// 产物落 `dist/` 且不产声明，所以走 devkit 时显式声明。
export default defineConfig({
  entry: {
    // 宿主现场打包 preload 的那份实现（壳经 `./preload-source` 取用）。
    "preload-source": "./src/preload-source.ts",
    wire: "./src/wire.ts",
    paths: "./src/paths.ts",
    // 桌面 overlay 用相对路径加载的行（patch 只认路径，不认包出口）。
    "settings-namespace": "./src/settings-namespace.ts",
  },
  plugins: [
    cordisPlugin({
      // 产物落 `.js` 而不是 `.mjs`/`.cjs`：壳与工具按 node 解析读这里的子出口；
      // 这样的**路径**加载它们（patch 行只认路径，不认包出口）。
      fixedExtension: false,
      dts: false,
    }),
  ],
});
