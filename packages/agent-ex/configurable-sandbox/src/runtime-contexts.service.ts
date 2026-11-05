// 运行时上下文的接管：本部署换了沙箱实现，模型看到的两段策略文本也要跟着换、换成中文。
//
// 上游在**全局层**注册 `sandbox:policy`（`@deepseek-ai/dsh-sandbox-policy`）与 `approval:policy`
// （`@deepseek-ai/dsh-user-approval`）。全局层同名注册会抛错，上游给的官方路径是**按 agent 作用域覆盖**：
// 在 agent 自己的 `ctx` 上注册同名 context，装配时近的作用域遮蔽全局那条；agentless 装配保持上游那条。
//
// 注册点必须是 `agent.ctx.get("systemPrompt")` 而不是注入来的那个实例：`context()` 的 scope 取自调用的
// ctx，注入实例绑定的是**本行** ctx，在它上面注册只会落在全局层（与上游那条撞名抛错）。
//
// 时机必须是 agent 创建时：`SystemPrompt.assemble()` 先把 `contexts` merge 好、再进瀑布，
// 挂在瀑布里注册只能从第二次装配起生效（会话里表现为"先英文后中文"）。
import type { Agent } from "@morlay/dsh-agent/contract";
import type { ApprovalPolicy } from "@morlay/dsh-permission/contract";
import { SandboxPolicy } from "@morlay/dsh-sandbox";
import { inject, Injectable, type Context, type OnInit } from "@morlay/zephyr";
import { SandboxRules } from "./contract/sandbox-rules.contract.ts";
import { AgentCreated } from "./events.ts";
import {
  APPROVAL_POLICY_CONTEXT,
  SANDBOX_POLICY_CONTEXT,
  renderApprovalContext,
  renderPolicyContext,
} from "./policy-text.ts";

// 提示词注册面（`ctx.get("systemPrompt")` 的读面）：只声明两条注册入口与两个 order 读取。
interface PromptRegistry {
  context(context: {
    readonly name: string;
    readonly order: number;
    readonly text: (context: unknown) => string;
  }): () => void;
  getContextOrder(name: string): number;
}

// 一次装配的上下文入参（本包只读 agent）。
interface AssembleContextLike {
  readonly agent?: { readonly session: { readonly id: string }; readonly ctx: Context };
}

// 上游 `ApprovalService` 的公开面：`overrideOf`（会话日志里最后一条 `approval/policy`）与 `config.policy`。
interface ApprovalSource {
  overrideOf(session: { readonly id: string }): ApprovalPolicy | undefined;
  readonly config: { readonly policy?: ApprovalPolicy };
}

// 某个会话此刻生效的审批策略：override 优先，否则部署默认，再退 `ask`。
function effectiveApprovalPolicy(
  approval: ApprovalSource,
  session: { readonly id: string },
): ApprovalPolicy {
  return approval.overrideOf(session) ?? approval.config.policy ?? "ask";
}

@Injectable()
export class SandboxRuntimeContexts implements OnInit {
  readonly created$ = new AgentCreated();

  private readonly rules = inject(SandboxRules);

  private readonly policy = inject(SandboxPolicy);

  private readonly installed = new WeakSet<Agent>();

  onInit(ctx: Context): void {
    this.created$.on(({ agent }) => {
      this.install(agent);
    });
    // 本行晚于已有 agent 挂载时（行重挂 / HMR）也要覆盖它们：`agent/created` 不会再为它们发一次。
    for (const agent of this.existingAgents(ctx)) this.install(agent);
  }

  private existingAgents(ctx: Context): readonly Agent[] {
    const registry = (ctx as unknown as { get(name: string, strict?: boolean): unknown }).get(
      "agents",
      false,
    ) as { list(): readonly Agent[] } | undefined;
    return registry?.list() ?? [];
  }

  private install(agent: Agent): void {
    if (this.installed.has(agent)) return;
    this.installed.add(agent);
    const prompt = (agent.ctx as unknown as { get(name: string, strict?: boolean): unknown }).get(
      "systemPrompt",
      false,
    ) as PromptRegistry | undefined;
    if (prompt === undefined) return;
    this.registerSandboxPolicy(prompt);
    this.registerApprovalPolicy(prompt);
  }

  // 在该 agent 的 scope 上注册同名 `sandbox:policy`：装配时遮蔽全局那条。
  private registerSandboxPolicy(prompt: PromptRegistry): void {
    const rules = this.rules.source();
    const policy = this.policy;
    prompt.context({
      name: SANDBOX_POLICY_CONTEXT,
      order: prompt.getContextOrder("SANDBOX_POLICY"),
      text: (context) => {
        const session = (context as AssembleContextLike).agent?.session;
        if (session === undefined) return "";
        return renderPolicyContext(policy.resolve({ session } as never), rules);
      },
    });
  }

  // 同上，接管 `approval:policy`：文本按会话有效策略选段。
  private registerApprovalPolicy(prompt: PromptRegistry): void {
    prompt.context({
      name: APPROVAL_POLICY_CONTEXT,
      order: prompt.getContextOrder("APPROVAL_POLICY"),
      text: (context) => {
        const current = (context as AssembleContextLike).agent;
        if (current === undefined) return "";
        // 审批能力是可选的（headless 部署可能没装）：没装就按"没有这条"读，空串遮蔽不了任何东西。
        const approval = (
          current.ctx as unknown as { get(name: string, strict?: boolean): unknown }
        ).get("approval", false) as ApprovalSource | undefined;
        return approval === undefined
          ? ""
          : renderApprovalContext(effectiveApprovalPolicy(approval, current.session));
      },
    });
  }
}
