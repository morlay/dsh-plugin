import { Module, without, type ProviderList } from "@morlay/zephyr";
import { jsExpr } from "@morlay/zephyr/compat";
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

const bashSandbox = BashSandbox.withConfig({ timeoutMs: 60000 });

const providers = (): ProviderList => [
  SubprocessDefault,
  SandboxDefault,
  bashSandbox,
  without(bashSandbox, jsExpr(() => process.platform === "win32")),
  SandboxPolicyDefault.withConfig({
    mode: jsExpr<"read-only" | "workspace-write" | "danger-full-access">(
      () =>
        (process.env.DSH_PERMISSION_MODE ?? "workspace-write") as
          | "read-only"
          | "workspace-write"
          | "danger-full-access",
    ),
    workspaceRoot: jsExpr(() => process.cwd()),
  }),
  FsSandbox,
  WorkingDirectoryDefault,
  FsObservationPolicy,
  ShellEnvDefault,
  ApprovalDefault.withConfig({
    policy: jsExpr(
      () =>
        (process.env.DSH_PERMISSION_MODE ?? "workspace-write") === "danger-full-access"
          ? "never"
          : "ask",
    ),
  }),
  PermissionDefault.withConfig({
    presets: {
      "read-only": { sandbox: "read-only", approval: "ask" },
      "workspace-write": { sandbox: "workspace-write", approval: "ask" },
      "danger-full-access": { sandbox: "danger-full-access", approval: "never" },
    },
  }),
];

@Module({ providers: providers() })
export class SandboxModule {
  static withConfig(): ProviderList {
    return providers();
  }
}
