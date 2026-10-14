import { defineConfig } from "tsdown";
import { cordisPlugin } from "@local/tsdown-plugin-cordis";

// dev 形态的前端服务：跑在宿主进程里、向 `webServer` 注册路由的那一半（同上游 `client/modules` 的角色）。
//
// `assets` / `styles` 单独出入口：它们是**运行期与构建期共用**的那两份实现（现场打包与 tsdown 构建必须
// 同形），构建侧（`@local/tsdown-plugin-cordis`）按子路径取用。
export default defineConfig({
  entry: {
    index: "./src/index.ts",
    assets: "./src/assets.ts",
    styles: "./src/styles.ts",
  },
  plugins: [cordisPlugin()],
});
