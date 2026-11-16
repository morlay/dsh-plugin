// **装配面**（`@morlay/zephyr-dev/node`）：开发运行时的那几行。
//
// 它们都 `inject` 宿主运行时（`AppEnv` / `WebServer` / `ClientAssets`），
// 所以从主出口出来会把 vite 的模块图带进每个只想要 `bundlePackage` 的地方。
export * from "./federation/index.ts";
export * from "./vite-handoff/index.ts";
export * from "./client-assets/vite-client-assets.service.ts";
export * from "./client-modules/index.ts";
export * from "./http/index.ts";
export * from "./dev-hmr/provide.ts";
export * from "./internal/server-hmr.ts";
