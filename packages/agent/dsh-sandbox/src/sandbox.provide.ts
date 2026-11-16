import { type SandboxMode } from "@deepseek-ai/dsh-sandbox";
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

const BASH_TIMEOUT_MS = 60_000;

// 只定**模式**：兜底根（`workspaceRoot`）的缺省由 `SandboxPolicyDefault` 在装配期从 `AppEnv` 取，
// 不写成模块级常量——那等于在装配面之外又猜了一次 cwd。
const DEFAULTS: { readonly mode: SandboxMode } = { mode: "workspace-write" };

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
 * 兜底根不给时取 `AppEnv.defaultWorkingDirectory`；要换值就
 * `provideSandbox(configure(SandboxPolicyDefault, { mode, workspaceRoot }))`。
 */
// Windows 没有沙箱 runner：`bash` 这一行在那边由 feature 剔除（装配面仍可自行 `configure` 它）。
const base = provide(defaults);

export const provideSandbox = (...features: ProviderFeature[]): ProviderList =>
  base(...(process.platform === "win32" ? [without(BashSandbox), ...features] : features));
