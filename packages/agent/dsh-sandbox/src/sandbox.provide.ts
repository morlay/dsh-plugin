import { SandboxMode } from "@deepseek-ai/dsh-sandbox";
import { configure, provide, without, type ProviderEntry } from "@morlay/zephyr";
import { BashSandbox } from "./bash-sandbox.service.ts";
import { FsObservationPolicy } from "./fs-observation-policy.service.ts";
import { FsSandbox } from "./fs-sandbox.service.ts";
import { SandboxPolicyDefault } from "./sandbox-policy.service.ts";
import { SandboxDefault } from "./sandbox.service.ts";

/** 沙箱的策略输入：部署默认模式与 `workspace-write` 的兜底根。 */
export interface SandboxConfig {
  /** 会话覆盖之下的部署默认模式。 */
  readonly mode: SandboxMode;
  /** 没有会话 cwd 的调用按这个根做 `workspace-write` 边界。 */
  readonly workspaceRoot: string;
}

const BASH_TIMEOUT_MS = 60_000;

/** 默认：`workspace-write` + 启动目录。 */
const DEFAULTS: SandboxConfig = { mode: "workspace-write", workspaceRoot: process.cwd() };

const defaults: ProviderEntry[] = [
  SandboxDefault,
  ...configure(BashSandbox, { timeoutMs: BASH_TIMEOUT_MS })([BashSandbox]),
  ...configure(SandboxPolicyDefault, DEFAULTS)([SandboxPolicyDefault]),
  FsSandbox,
  FsObservationPolicy,
];

/**
 * 沙箱的六行装配。模式与根由装配面显式给（同一个 `DSH_PERMISSION_MODE` 还驱动 approval，
 * 那次读取只发生在装配面）；配置在装配期求值，模块作用域不读环境变量。
 *
 * 装配面要换值：`provideSandbox(configure(SandboxPolicyDefault, { mode, workspaceRoot }))`。
 */
// `without` 只把这一行写进 patch 的 disabled（Windows 没有沙箱 runner）；
// 运行期条目仍按 `BashSandbox` 的身份保留，剔除与替换可以共存。
export const provideSandbox = provide(without(BashSandbox, process.platform === "win32")(defaults));
