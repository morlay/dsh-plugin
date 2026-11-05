// permission 的宿主半（`@morlay/dsh-permission/server`）：把两组远端契约接到本包的契约服务上。
//
// 浏览器侧（上游 `ui-user-questions` / `ui-permission-presets`）按 descriptor 调
// `remote.<group>.<method>`；这里注册同名组，mux 才能把帧路由进来。
export * from "./user-questions-endpoint.service.ts";
export * from "./permission-presets-endpoint.service.ts";
export { providePermission, providePermissionFor } from "./permission.provide.ts";
