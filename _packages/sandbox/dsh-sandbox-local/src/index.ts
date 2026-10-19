
export { Config } from "./config.ts";
export { FilesystemService, SandboxLocal, SandboxService } from "./zephyr.service.ts";
export type { ResolvedConfig } from "./config.ts";

// 行 id 与 Provider 的 token 名同形（`SandboxLocal` → `sandbox-local`）。
export const name = "sandbox-local";

export { default } from "./cordis-register.ts";
