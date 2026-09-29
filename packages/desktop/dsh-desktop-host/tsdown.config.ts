import { defineCordisPluginConfig } from "@local/devkit";

// 与上游 `apps/desktop-host` 同边界：`@deepseek-ai/*` 由部署自己的 `node_modules` 提供（`dependencies` /
// `peerDependencies` 里的包 tsdown 默认留着 external）。
// `webserver` 是可被 patch 行按相对路径加载的独立入口（`@deepseek-ai/dsh-host-webserver` 保持 external）；
// 产物落 `lib/` 且不产声明，所以走 devkit 时显式声明。
export default defineCordisPluginConfig({
  entries: {
    webserver: "./src/webserver.ts",
    wire: "./src/wire.ts",
  },
  outDir: "lib",
  fixedExtension: false,
  dts: false,
});
