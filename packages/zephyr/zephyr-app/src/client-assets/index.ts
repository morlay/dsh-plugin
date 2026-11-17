// 域 index：**只出契约**（`ClientAssets`）。dev 的实现住在开发运行时那个包——
// 它要 vite 与 vite 的交接面，而那两样是构建链，不是运行时；prod 实现 `StaticClientAssets` 只投文件，在同目录。
export * from "./client-assets.contract.ts";
