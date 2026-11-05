// 策略替身：官方 `SandboxPolicyDefault` 注入会话投影（本包测试不装会话域）。
//
// 装配面在 bootstrap 前设置两个 static 字段：`mode`（部署默认模式）与 `root`（workspace-write 兜底根）。
import { SandboxPolicy } from "@morlay/dsh-sandbox";
import type { SandboxExecutionPolicy, SandboxMode } from "@morlay/dsh-sandbox/contract";
import { Injectable } from "@morlay/zephyr";

@Injectable()
export class FakePolicy extends SandboxPolicy {
  static mode: SandboxMode = "workspace-write";

  static root = "/";

  readonly defaultMode = FakePolicy.mode;

  readonly workspaceRoot = FakePolicy.root;

  readonly additionalWritableRoots = undefined;

  resolve = (): SandboxExecutionPolicy => ({
    mode: this.defaultMode,
    workspaceRoot: this.workspaceRoot,
  });

  overrideOf = () => undefined;
}
