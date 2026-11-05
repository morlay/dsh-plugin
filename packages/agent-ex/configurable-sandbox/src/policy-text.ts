// 运行时策略文本：本部署换了沙箱实现，模型看到的那两段也要跟着换、换成中文。
//
// 挂载方式在 `runtime-contexts.service.ts`：按 agent 作用域注册同名 context，遮蔽上游在全局层注册的那条。
import type { SandboxExecutionPolicy } from "@morlay/dsh-sandbox/contract";
import type { ApprovalPolicy } from "@morlay/dsh-permission/contract";
import type { RuleSource } from "./rules.ts";

// 上游注册的运行时上下文名：同名才叫接管。
export const SANDBOX_POLICY_CONTEXT = "sandbox:policy";
export const APPROVAL_POLICY_CONTEXT = "approval:policy";

// 官方三种 mode 的中文语义 + 本部署追加的规则；返回给模型看的一段文本。
export function renderPolicyContext(policy: SandboxExecutionPolicy, rules: RuleSource): string {
  const base = ((): string => {
    switch (policy.mode) {
      case "read-only":
        return "文件策略：只读——不能修改任何文件。别因此拒绝必需的修改：照常尝试工具，按它的拒绝与升级指引行动。";
      case "workspace-write":
        return `文件策略：workspace-write——可改会话工作区 ${JSON.stringify(policy.workspaceRoot)} 下的文件，部分平台临时目录同样可写。`;
      case "danger-full-access":
        return "文件策略：全权——文件改动不再受限。";
    }
  })();

  const extras: string[] = [];
  if (rules.allowWrite.length > 0) {
    extras.push(`额外可写：${rules.allowWrite.join("、")}。`);
  }
  if (rules.readOnly.length > 0) {
    extras.push(`只读（不可写）：${rules.readOnly.join("、")}。`);
  }
  if (rules.deny.length > 0) {
    extras.push(`拒绝（读写都拒）：${rules.deny.join("、")}。`);
  }
  return extras.length === 0 ? base : `${base} ${extras.join("")}`;
}

// `approval:policy` 的两段文本。`never` 是确定性拒绝，所以顺带告诉模型别去要沙箱升级。
const APPROVAL_ASK_TEXT = "审批策略：ask——需要审批的操作会询问用户；没有可用的应答者时直接失败。";
const APPROVAL_NEVER_TEXT =
  "审批提示已禁用：需要审批的操作一律自动拒绝——不要请求沙箱升级（不要设 sandbox_permissions）。";

// 策略文本按会话的有效策略选段。
export function renderApprovalContext(policy: ApprovalPolicy): string {
  return policy === "never" ? APPROVAL_NEVER_TEXT : APPROVAL_ASK_TEXT;
}
