import { InjectionToken } from "@morlay/zephyr";

// dsh-web-app 是 dsh-base 之上的 Web 宿主层：Web 官方适配只保留在 dsh-base，这里按需复用。
export { Web } from "@morlay/dsh-base/web";
export { DshWebAppHostModule } from "./web-app.host.module.ts";
export { DshWebAppPatchModule } from "./web-app.patch.module.ts";
// 依赖官方 loader 的行（代码组合形态里由入口 Module 用 `without` 停用）。
export { DirectoryPicker } from "./open-in-app/open-in-app.service.ts";
export { PluginInventory } from "./plugin-inventory/plugin-inventory.service.ts";
export { WebRuntimeService } from "./web/web.service.ts";
/** 官方 loader 的最小读面（`settings` 等行只用到 `await()` 与 `entries()`）。 */
export const LoaderToken = new InjectionToken<{
  await(): Promise<void>;
  entries(): Iterable<unknown>;
}>("loader");
export { ProfileContextToken, type ProfileContext } from "./settings/profile-context.ts";
