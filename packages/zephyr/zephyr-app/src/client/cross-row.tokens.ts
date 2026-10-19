// 跨行共享注册表的令牌：服务名与实例都由**创建它的上游行**决定（`ctx.reflect.provide('<name>', …)`），
// 令牌只负责让消费方按类型拿到同一份实例（`InjectionToken` 自带 `serviceName`，`namedServiceOf` 按名解析）。
//
// 两个令牌各自成文件（`sidebar-right-tabs.ts` / `settings-schema.ts`），这里只保留既有的聚合入口。
export { SidebarRightTabs } from "./sidebar-right-tabs.ts";
export { SettingsSchema } from "./settings-schema.ts";
