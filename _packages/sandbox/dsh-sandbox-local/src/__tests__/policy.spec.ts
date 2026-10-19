// 接管两条运行时上下文：本部署换了沙箱实现、也要中文的审批措辞，`sandbox:policy` 与 `approval:policy` 都必须在
// agent 的**第一次**装配里就是我们的文本（挂在装配瀑布里注册只能从第二次起生效——会话里表现为"先英文后中文"）。
import { Context } from "@deepseek-ai/cordis";
import { assembleContextFor, type Agent } from "@deepseek-ai/dsh-agent";
import {
  mountAgentLoopTestDependencies,
  mountAgentLoopTestHarness,
} from "@deepseek-ai/dsh-agent-loop-testkit";
import { SessionId } from "@deepseek-ai/dsh-session";
import { afterEach, describe, expect, it } from "vitest";
import {
  APPROVAL_POLICY_CONTEXT,
  installRuntimeContexts,
  renderApprovalContext,
  renderPolicyContext,
  SANDBOX_POLICY_CONTEXT,
} from "../policy.ts";

const OFFICIAL_SANDBOX_TEXT = "Current DSH file policy: workspace-write. …";
const OFFICIAL_APPROVAL_TEXT = "Approval policy: ask. Operations that require approval …";

const RULES = { allowWrite: ["/tmp"], readOnly: ["/ro"], deny: ["**/*.pem"] };

const EMPTY_RULES = { allowWrite: [], readOnly: [], deny: [] };

const contexts: Context[] = [];
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose();
});

// 真装配的底座：真 systemPrompt + 真 agents（AgentLoop），另加"上游那两条全局层注册"与 approval 服务替身
// （替身只实现本包读的公开面：`overrideOf` + `config.policy`）。
async function mount(
  options: { readonly defaultPolicy?: "ask" | "never"; readonly override?: "ask" | "never" } = {},
) {
  const ctx = new Context();
  contexts.push(ctx);
  await mountAgentLoopTestDependencies(ctx, { systemPrompt: { includeHarnessIdentity: false } });
  const harness = await mountAgentLoopTestHarness(ctx);
  ctx.systemPrompt.context({
    name: SANDBOX_POLICY_CONTEXT,
    order: ctx.systemPrompt.getContextOrder("SANDBOX_POLICY"),
    text: () => OFFICIAL_SANDBOX_TEXT,
  });
  ctx.systemPrompt.context({
    name: APPROVAL_POLICY_CONTEXT,
    order: ctx.systemPrompt.getContextOrder("APPROVAL_POLICY"),
    text: () => OFFICIAL_APPROVAL_TEXT,
  });
  ctx.provide("approval", {
    overrideOf: () => options.override,
    config: { policy: options.defaultPolicy ?? "ask" },
  } as never);
  return { ctx, harness };
}

function install(ctx: Context): void {
  installRuntimeContexts(ctx, RULES, () => ({ mode: "workspace-write", workspaceRoot: "/w" }));
}

async function contextsOf(ctx: Context, agent: Agent): Promise<Map<string, string>> {
  const assembled = await ctx.systemPrompt.assemble(assembleContextFor(agent));
  return new Map(assembled.contexts.map((entry) => [entry.name, entry.text]));
}

describe("sandbox:policy 的文本", () => {
  it("三种模式的语义 + 规则行简写", () => {
    expect(renderPolicyContext({ mode: "read-only", workspaceRoot: "/w" }, EMPTY_RULES)).toContain(
      "文件策略：只读——不能修改任何文件",
    );
    expect(
      renderPolicyContext({ mode: "workspace-write", workspaceRoot: "/w" }, EMPTY_RULES),
    ).toContain('文件策略：workspace-write——可改会话工作区 "/w" 下的文件');
    expect(
      renderPolicyContext({ mode: "danger-full-access", workspaceRoot: "/w" }, EMPTY_RULES),
    ).toContain("文件策略：全权——文件改动不再受限");

    const withRules = renderPolicyContext({ mode: "workspace-write", workspaceRoot: "/w" }, RULES);
    expect(withRules).toContain("额外可写：/tmp。");
    expect(withRules).toContain("只读（不可写）：/ro。");
    expect(withRules).toContain("拒绝（读写都拒）：**/*.pem。");
    expect(
      renderPolicyContext({ mode: "workspace-write", workspaceRoot: "/w" }, EMPTY_RULES),
    ).not.toContain("额外可写");
  });
});

describe("agent 的第一次装配", () => {
  it("agent 创建时装的那份：第一次装配就是中文，两次一致（不再先英文后中文）", async () => {
    const { ctx, harness } = await mount();
    install(ctx);
    const agent = await harness.create(SessionId("policy-first"));

    const first = (await contextsOf(ctx, agent)).get(SANDBOX_POLICY_CONTEXT);
    const second = (await contextsOf(ctx, agent)).get(SANDBOX_POLICY_CONTEXT);

    expect(first).toContain("额外可写：/tmp。");
    expect(first).not.toBe(OFFICIAL_SANDBOX_TEXT);
    expect(second).toBe(first);
  });

  it("本行晚于 agent 挂载（行重挂）时也覆盖已经存在的 agent", async () => {
    const { ctx, harness } = await mount();
    const agent = await harness.create(SessionId("policy-existing"));
    install(ctx);

    expect((await contextsOf(ctx, agent)).get(SANDBOX_POLICY_CONTEXT)).toContain("/tmp");
  });

  it("agentless 装配保持上游那条（我们的注册只在 agent 作用域）", async () => {
    const { ctx } = await mount();
    install(ctx);

    const assembled = await ctx.systemPrompt.assemble({});
    expect(assembled.contexts.find((entry) => entry.name === SANDBOX_POLICY_CONTEXT)?.text).toBe(
      OFFICIAL_SANDBOX_TEXT,
    );
  });
});

describe("approval:policy 的文本", () => {
  it("两种策略各一段（照抄用户确认的措辞）", () => {
    expect(renderApprovalContext("ask")).toBe(
      "审批策略：ask——需要审批的操作会询问用户；没有可用的应答者时直接失败。",
    );
    expect(renderApprovalContext("never")).toBe(
      "审批提示已禁用：需要审批的操作一律自动拒绝——不要请求沙箱升级（不要设 sandbox_permissions）。",
    );
  });

  it("部署默认是 ask：第一次装配就是中文那条", async () => {
    const { ctx, harness } = await mount();
    install(ctx);
    const agent = await harness.create(SessionId("approval-ask"));

    const text = (await contextsOf(ctx, agent)).get(APPROVAL_POLICY_CONTEXT);
    expect(text).toBe("审批策略：ask——需要审批的操作会询问用户；没有可用的应答者时直接失败。");
    expect(text).not.toBe(OFFICIAL_APPROVAL_TEXT);
  });

  it("会话覆盖 never：读的是覆盖后的有效策略", async () => {
    const { ctx, harness } = await mount({ defaultPolicy: "ask", override: "never" });
    install(ctx);
    const agent = await harness.create(SessionId("approval-never"));

    expect((await contextsOf(ctx, agent)).get(APPROVAL_POLICY_CONTEXT)).toContain("审批提示已禁用");
  });

  it("部署默认就是 never（没有会话覆盖）：也是那条", async () => {
    const { ctx, harness } = await mount({ defaultPolicy: "never" });
    install(ctx);
    const agent = await harness.create(SessionId("approval-default-never"));

    expect((await contextsOf(ctx, agent)).get(APPROVAL_POLICY_CONTEXT)).toContain("审批提示已禁用");
  });

  it("没装审批服务时这条是空的（遮蔽不了不存在的上游那条）", async () => {
    const ctx = new Context();
    contexts.push(ctx);
    await mountAgentLoopTestDependencies(ctx, { systemPrompt: { includeHarnessIdentity: false } });
    const harness = await mountAgentLoopTestHarness(ctx);
    install(ctx);
    const agent = await harness.create(SessionId("approval-absent"));

    expect((await contextsOf(ctx, agent)).get(APPROVAL_POLICY_CONTEXT)).toBe("");
  });
});
