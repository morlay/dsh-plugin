// 沙箱策略契约：令牌按服务语义命名（上游注册名 `sandboxPolicy`）。
import type { SandboxPolicyService } from "@deepseek-ai/dsh-sandbox-policy";
import { Injectable } from "@morlay/zephyr";

interface SandboxPolicyFace {
  readonly resolve: SandboxPolicyService["resolve"];
  readonly overrideOf: SandboxPolicyService["overrideOf"];
}

@Injectable()
export abstract class SandboxPolicy implements SandboxPolicyFace {
  abstract readonly resolve: SandboxPolicyFace["resolve"];

  abstract readonly overrideOf: SandboxPolicyFace["overrideOf"];
}
