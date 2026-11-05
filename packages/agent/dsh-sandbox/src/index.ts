// sandbox 域的包根：契约 + 行 + 装配模块（聚合 `./contract`）。
export * from "./contract/index.ts";
export * from "./local-sandbox.ts";
export * from "./sandbox.service.ts";
export * from "./sandbox-policy.service.ts";
export * from "./bash-sandbox.service.ts";
export * from "./fs-sandbox.service.ts";
export * from "./fs-observation-policy.service.ts";
// 文件 / 检索两条工具行（`read`/`write`/`edit`、`glob`/`grep`）：它们要沙箱策略，属沙箱域。
export * from "./bash.tool.ts";
export * from "./fs.tool.ts";
export * from "./fs-search.tool.ts";
export { provideFsTools } from "./fs-tools.provide.ts";

// `workspaceFiles` 的宿主面属 workspace 域（`@morlay/dsh-workspace/server`）：沙箱不认识它。
export * from "./sandbox.provide.ts";

// 本包契约与上游同名（`SandboxPolicy`）：包根只出本包这一份。
export { SandboxPolicy } from "./contract/index.ts";
// 上游 `SandboxPolicyService`：本包的 `SandboxPolicyDefault` 经 `fromCordis` 接管它，域内 spec 要按它断言
// 「令牌解析出的是上游那个类」。包根只转这一个上游词（全仓消费方从包根取的上游符号就它一个）。
export { SandboxPolicyService } from "@deepseek-ai/dsh-sandbox-policy";
// 上游 `fs-observation-policy` 的插件（观察策略）：归沙箱域。与同名契约 `FsObservationPolicy` 区分开。
export * as FsObservationPolicyPlugin from "@deepseek-ai/dsh-fs-observation-policy";

// **上游词一个都不从包根透出**：全仓 `from "@morlay/dsh-sandbox"` 的消费方只取本包的符号
// （`Sandbox` / `SandboxDefault` / `SandboxPolicy` / `SandboxPolicyDefault` / `FsSandbox` / `BashSandbox` /
// `LocalSandboxProvider` / `LocalSandboxConfig` / `WorkspaceFilesDefault` / `provideSandbox` /
// `provideWorkspaceFiles`）。要上游词汇（`SANDBOX_MODES` / `setSandboxMode` / `SandboxProvider` …）就直接引
// 上游包，或走 `./contract`。
//
// 为什么不用整包透传（`export * from` 加沙箱上游包名）：它把上游同名符号与本包契约一起摊平，撞名时
// **两边都拿不到**（`FsObservationPolicy` 曾因此运行期是 `undefined`，`ctx.plugin(undefined)` 静默不装）。
