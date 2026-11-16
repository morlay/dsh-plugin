// 契约（`Federation` / `FederationConfig`）留在 `zephyr-app`：它描述的是**运行时**按 URL 取产物的缝，
// 与"怎么构建"无关。这一面只出构建与预编译的实现。
export * from "./bundle.ts";
export * from "./parse-url.ts";
export * from "./federation.service.ts";
export * from "./provide.ts";
export * from "./watch.ts";
