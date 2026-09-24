import { defineCordisPluginConfig } from "@local/devkit";

// 与上游 `apps/desktop-host` 同边界：`@deepseek-ai/*` 由部署自己的 `node_modules` 提供
// （`dependencies` / `peerDependencies` 里的包 tsdown 默认留着 external），vendor 里的
// `workspace-dependencies` 模块在构建期内联进产物。`webserver` 是可被 patch 行按相对路径
// 加载的独立入口（`@deepseek-ai/dsh-host-webserver` 保持 external，部署 runtime 里有）。
//
// 产物落 `lib/` 且不产声明（壳按 `<runtime>/node_modules/@morlay/dsh-desktop-host/lib/index.js`
// 直接起进程，发布包里不带 `src`），这是与其它包唯一的差别，所以走 devkit 时显式声明。
export default defineCordisPluginConfig({
  entries: {
    webserver: "./src/webserver.ts",
    wire: "./src/wire.ts",
  },
  outDir: "lib",
  fixedExtension: false,
  dts: false,
});
