import { Module, without, type ProviderList } from "@morlay/zephyr";
import { SubprocessDefault } from "./subprocess.service.ts";
import { SandboxDefault } from "./sandbox.service.ts";
import { SandboxPolicyDefault } from "./sandbox-policy.service.ts";
import { BashSandbox } from "./bash-sandbox.service.ts";
import { FsSandbox } from "./fs-sandbox.service.ts";
import { WorkingDirectoryDefault } from "./working-directory.service.ts";
import { FsObservationPolicy } from "./fs-observation-policy.service.ts";
import { ShellEnvDefault } from "./shell-env.service.ts";
import { ApprovalDefault } from "./approval.service.ts";
import { PermissionDefault } from "./permission.service.ts";

// 配置在**装配期**求值（`jsExpr` 只对 `fromCordis` 的适配行生效，普通 Provider 拿到的是表达式对象）；
// 环境变量只在装配函数内读一次（不在模块作用域），之后一律走注入/显式值。
const providers = (): ProviderList => {
  const isWindows = process.platform === "win32";
  const permissionMode = (process.env.DSH_PERMISSION_MODE ?? "workspace-write") as
    | "read-only"
    | "workspace-write"
    | "danger-full-access";
  const bashSandbox = BashSandbox.withConfig({ timeoutMs: 60000 });
  return [
  SubprocessDefault,
  SandboxDefault,
  bashSandbox,
  without(bashSandbox, isWindows),
  SandboxPolicyDefault.withConfig({ mode: permissionMode, workspaceRoot: process.cwd() }),
  FsSandbox,
  WorkingDirectoryDefault,
  FsObservationPolicy,
  ShellEnvDefault,
  ApprovalDefault.withConfig({
    policy: permissionMode === "danger-full-access" ? "never" : "ask",
  }),
  PermissionDefault.withConfig({
    presets: {
      "read-only": { sandbox: "read-only", approval: "ask" },
      "workspace-write": { sandbox: "workspace-write", approval: "ask" },
      "danger-full-access": { sandbox: "danger-full-access", approval: "never" },
    },
  }),
  ];
};

@Module({ providers: providers() })
export class SandboxModule {
  static withConfig(): ProviderList {
    return providers();
  }
}
