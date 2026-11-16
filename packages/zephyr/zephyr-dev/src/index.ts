// **zephyr-dev 的主出口**：开发运行时与构建器里**不需要装配**的那一半——
// 联邦预编译（`bundlePackage` / `prebundleAll` / `planPrebundle`）、URL 前缀改写、解析规则、告警名单。
//
// 装配行（`ClientModulesDefault` / `ViteClientAssets` / `ViteHandoffDefault` / `ServerHmr`）
// 在 `./node`：它们要 `AppEnv` / `WebServer` / `Federation`，装起来就等于装了宿主运行时。
//
// 依赖方向：`zephyr-cli → zephyr-dev → zephyr-app → zephyr`。**单向**：app 不认识 dev，
// 否则 `pnpm -r` 的任务图成环（`just audit` / `just build` 直接拒跑）。
export * from "./federation/bundle.ts";
export * from "./federation/parse-url.ts";
export * from "./federation/prebundle.ts";
export * from "./federation/prebundle-plan.ts";
export * from "./federation/watch.ts";
export * from "./internal/hmr-path.ts";
export * from "./internal/resolve.ts";
export * from "./rows/dev-files.ts";
