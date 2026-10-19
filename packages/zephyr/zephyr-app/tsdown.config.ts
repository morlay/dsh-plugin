import { defineConfig } from "tsdown";
import { cordisPlugin } from "@local/tsdown-plugin-cordis";

// dev 形态的前端服务：跑在宿主进程里、向 `webServer` 注册路由的那一半（同上游 `client/modules` 的角色）。
//
// 样式与资产那两份共用实现（`assets` / `styles`）不在这里：它们归**构建期**那一侧，作为
// `@local/tsdown-plugin-cordis` 的 `./assets`、`./styles` 子出口提供（本包只以 `dependencies` 依赖它）。
export default defineConfig({
  entry: {
    index: "./src/index.ts",
  },
  plugins: [cordisPlugin()],
});
