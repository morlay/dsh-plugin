import type { Agent } from "@deepseek-ai/dsh-agent";
import type { Context } from "@deepseek-ai/cordis";
import type { SandboxExecutionPolicy } from "@deepseek-ai/dsh-sandbox";
import type { Session } from "@deepseek-ai/dsh-session";
import type {} from "@deepseek-ai/dsh-system-prompt";
// Type-only：`approval:policy` 的取值面（`ApprovalPolicy` 与 `ApprovalService.overrideOf`）。
import type { ApprovalPolicy } from "@deepseek-ai/dsh-user-approval";
import type { RuleSource } from "./rules.ts";

// 接管两条运行时上下文：上游在**全局层**注册的 `sandbox:policy`（`@deepseek-ai/dsh-sandbox-policy`）与
// `approval:policy`（`@deepseek-ai/dsh-user-approval`）。本部署换了沙箱实现、也要自己的中文措辞，两条都在
// agent 自己的 `ctx` 上注册**同名** context——装配时近的作用域遮蔽全局那条（`ScopedLayers.merge`），全局那条
// 对 agentless 装配仍然生效。全局层同名注册会抛错（`NamedEntries.insert`），作用域遮蔽是上游给的官方路径。
//
// 时机：注册必须早于该 agent 的**第一次**装配。`SystemPrompt.assemble()` 先把 `contexts` merge 好、再进
// `system-prompt/assemble` 瀑布，所以挂在瀑布里注册只能从第二次装配起生效（会话里表现为"先英文后中文"）；
// `agent/created` 是创建期最后一步、早于第一次装配，在那里注册即可（persona 用的是同一手法）。

// 上游注册的运行时上下文名：同名才叫接管。
export const SANDBOX_POLICY_CONTEXT = "sandbox:policy";
export const APPROVAL_POLICY_CONTEXT = "approval:policy";

// 策略文本：官方三种 mode 的中文语义 + 本部署追加的规则；返回给模型看的一段文本。
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

// 上游 `ApprovalService` 的公开面：`overrideOf`（会话日志里最后一条 `approval/policy`）与 `config.policy`
// （部署默认）。`effectivePolicy` 是私有的，所以在这里复刻它的同一算法（override 优先，否则 config 默认，
// 再退到 `ask`——schema 已经把缺省填成 `ask`，这一层只是兜住手写的装配 config）。
interface ApprovalSource {
  overrideOf(session: Session): ApprovalPolicy | undefined;
  readonly config: { readonly policy?: ApprovalPolicy };
}

// 某个会话此刻生效的审批策略。
function effectiveApprovalPolicy(approval: ApprovalSource, session: Session): ApprovalPolicy {
  return approval.overrideOf(session) ?? approval.config.policy ?? "ask";
}

// 在给定作用域注册同名策略文本（agent 的 `ctx`）——该 scope 因此遮蔽全局那条。
// `ctx.get` 而不是 `ctx.systemPrompt`：本行没在 `inject` 里点名 systemPrompt，属性访问会被 cordis 拒绝。
function registerPolicyContext(
  scope: Context,
  rules: RuleSource,
  resolve: (session: Session) => SandboxExecutionPolicy,
): void {
  const prompt = scope.get("systemPrompt");
  if (prompt === undefined) return;
  prompt.context({
    name: SANDBOX_POLICY_CONTEXT,
    order: prompt.getContextOrder("SANDBOX_POLICY"),
    text: (context) => {
      const session = context.agent?.session;
      return session === undefined ? "" : renderPolicyContext(resolve(session), rules);
    },
  });
}

// 同上，接管 `approval:policy`：读的是上游服务公开面里的有效策略，文本按它选段。
function registerApprovalContext(scope: Context): void {
  const prompt = scope.get("systemPrompt");
  if (prompt === undefined) return;
  prompt.context({
    name: APPROVAL_POLICY_CONTEXT,
    order: prompt.getContextOrder("APPROVAL_POLICY"),
    text: (context) => {
      const agent = context.agent;
      if (agent === undefined) return "";
      // 审批能力是可选的（headless 部署可能没装）：没装就按"没有这条"读，空串遮蔽不了任何东西。
      const approval = agent.ctx.get("approval") as ApprovalSource | undefined;
      return approval === undefined
        ? ""
        : renderApprovalContext(effectiveApprovalPolicy(approval, agent.session));
    },
  });
}

// 每个 agent 注册一次，时机是它创建时——必须早于第一次装配（见文件头）。
export function installRuntimeContexts(
  ctx: Context,
  rules: RuleSource,
  resolve: (session: Session) => SandboxExecutionPolicy,
): void {
  const installed = new WeakSet<Agent>();
  const install = (agent: Agent): void => {
    if (installed.has(agent)) return;
    installed.add(agent);
    registerPolicyContext(agent.ctx, rules, resolve);
    registerApprovalContext(agent.ctx);
  };
  ctx.on("agent/created", ({ agent }) => {
    install(agent);
  });
  // 本行晚于已有 agent 挂载时（行重挂 / HMR）也要覆盖它们：`agent/created` 不会再为它们发一次。
  for (const agent of ctx.get("agents")?.list() ?? []) install(agent);
}
