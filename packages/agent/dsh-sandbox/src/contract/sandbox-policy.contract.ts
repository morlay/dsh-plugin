// 沙箱策略契约：令牌按服务语义命名（上游注册名 `sandboxPolicy`）。
import type { SandboxPolicyService } from "@deepseek-ai/dsh-sandbox-policy";
import { Injectable } from "@morlay/zephyr";
import { AssertCovered, AssertTrue } from "@morlay/zephyr-app";

/**
 * 契约面：上游 `SandboxPolicyService` 的全部公开成员，与上游同名同签名。
 *
 * 下面的覆盖守卫在编译期核对，漏一个就报出成员名。
 */
/** 覆盖守卫：上游有而契约没列出的成员，编译期必须为空。 */
export type SandboxPolicyCovered = AssertTrue<AssertCovered<SandboxPolicyService, SandboxPolicy>>;

@Injectable()
export abstract class SandboxPolicy {
  abstract readonly defaultMode: SandboxPolicyService["defaultMode"];

  abstract readonly workspaceRoot: SandboxPolicyService["workspaceRoot"];

  abstract readonly resolve: SandboxPolicyService["resolve"];

  abstract readonly overrideOf: SandboxPolicyService["overrideOf"];

  abstract readonly additionalWritableRoots: SandboxPolicyService["additionalWritableRoots"];
}
