import { SandboxMode } from "@deepseek-ai/dsh-sandbox";
import {
  provide,
  without,
  type ProviderEntry,
  type ProviderFeature,
  type ProviderList,
} from "@morlay/zephyr";
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

// 顺序即装配顺序：`BashSandbox` 的宿主行在 apply 期就按名字读 `sandboxPolicy`，策略行必须在前，
// 否则权限预设会以「mounted bash executor does not confine」拒绝启动。
const defaults: ProviderEntry[] = [
  SandboxDefault,
  { provide: SandboxPolicyDefault, config: DEFAULTS },
  { provide: BashSandbox, config: { timeoutMs: BASH_TIMEOUT_MS } },
  FsSandbox,
  FsObservationPolicy,
];

/**
 * 沙箱的六行装配。模式与根由装配面显式给（同一个 `DSH_PERMISSION_MODE` 还驱动 approval，
 * 那次读取只发生在装配面）；配置在装配期求值，模块作用域不读环境变量。
 *
 * 装配面要换值：`provideSandbox(configure(SandboxPolicyDefault, { mode, workspaceRoot }))`。
 */
// Windows 没有沙箱 runner：`bash` 这一行在那边由 feature 剔除（装配面仍可自行 `configure` 它）。
const base = provide(defaults);

export const provideSandbox = (...features: ProviderFeature[]): ProviderList =>
  base(...(process.platform === "win32" ? [without(BashSandbox), ...features] : features));
