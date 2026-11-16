// 域 index：契约 + dev 实现。本包自己的 `provideClientModules()` 直接用实现文件；
// 对外的路口是 `./node`（与 `vite-handoff` 同一条规矩：dev 的东西不进主出口）。
export * from "./client-assets.contract.ts";
export * from "./vite-client-assets.service.ts";
