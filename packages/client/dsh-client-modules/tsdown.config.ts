import { defineConfig } from "tsdown";
import { cordisPlugin } from "@local/tsdown-plugin-cordis";

// dev 形态的前端服务：跑在宿主进程里、向 `webServer` 注册路由的那一半（同上游 `client/modules` 的角色）。
export default defineConfig({
  plugins: [cordisPlugin()],
});
