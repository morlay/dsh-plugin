import { defineCordisPluginConfig } from "@local/devkit";

// 与上游 `client/modules` 同位置、同角色：跑在宿主进程里，向 `webServer` 注册路由的那一半。
// `@deepseek-ai/*`（cordis、webserver）由部署自己的 `node_modules` 提供，tsdown 默认留着 external；
// vite 是运行时依赖，同样不打包（它带原生绑定，必须单实例）。
export default defineCordisPluginConfig({
  entries: {
    index: "./src/index.ts",
  },
  outDir: "dist",
  fixedExtension: false,
  dts: false,
});
