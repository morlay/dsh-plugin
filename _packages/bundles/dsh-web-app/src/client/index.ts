// 浏览器侧的 client 半入口：装配面就是 `@Module`，转成 cordis 插件交给 `app-boot` 的 `ctx.plugin`。
// `default` 是 `toCordis(Module)` 的结果（与 host 侧同一套声明，不再用 package.json 的 `dsh.client` 判身份）。
import { toCordis } from "@morlay/zephyr/compat";
import { DshWebAppClientPluginsModule } from "../web-app.client.module.ts";

export default toCordis(DshWebAppClientPluginsModule);

export { DshWebAppClientPluginsModule } from "../web-app.client.module.ts";
