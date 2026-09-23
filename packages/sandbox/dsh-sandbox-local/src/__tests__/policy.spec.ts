// 接管 `sandbox:policy`：本部署换了沙箱实现，那段策略文本必须跟着换，否则模型看到的是官方规则。
import { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { createScope, scopeOf, type ScopeKey } from "@deepseek-ai/dsh-scope";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import { afterEach, describe, expect, it } from "vitest";
import {
  installPolicyContext,
  registerPolicyContext,
  renderPolicyContext,
  SANDBOX_POLICY_CONTEXT,
} from "../policy.ts";

const OFFICIAL_TEXT = "Current DSH file policy: workspace-write. …";

const RULES = { allowWrite: ["/tmp"], readOnly: ["/ro"], deny: ["**/*.pem"] };

const contexts: Context[] = [];
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose();
});

/** 拿一个一定会有的 scope key（`createScope` 建的 scope 必有）。 */
function keyOf(ctx: Context): ScopeKey {
  const key = scopeOf(ctx);
  if (key === undefined) throw new Error("测试的 scope 必须有 key");
  return key;
}

/** 一个假的 agent：策略文本只读它的 session（这里用不到内容，resolve 是 stub）。 */
function fakeAgent(agentCtx: Context): Agent {
  return { ctx: agentCtx, session: { header: { cwd: "/w" } } } as unknown as Agent;
}

async function mount(): Promise<{ root: Context; scope: Context }> {
  const root = new Context();
  contexts.push(root);
  await root.plugin(SystemPrompt, { includeHarnessIdentity: false });
  // 模拟上游 sandbox-policy：在全局层注册同名的策略文本。
  root.systemPrompt.context({
    name: SANDBOX_POLICY_CONTEXT,
    order: root.systemPrompt.getContextOrder("SANDBOX_POLICY"),
    text: () => OFFICIAL_TEXT,
  });
  const scope = createScope(root, { preset: "coding" });
  return { root, scope: scope.ctx };
}

describe("sandbox:policy 的文本", () => {
  it("三种模式各有官方语义，规则非空时追加在末尾", () => {
    const empty = { allowWrite: [], readOnly: [], deny: [] };

    expect(renderPolicyContext({ mode: "read-only", workspaceRoot: "/w" }, empty)).toContain("只读");
    expect(renderPolicyContext({ mode: "workspace-write", workspaceRoot: "/w" }, empty)).toContain(
      "workspace-write（工作区可写）",
    );
    expect(
      renderPolicyContext({ mode: "danger-full-access", workspaceRoot: "/w" }, empty),
    ).toContain("danger-full-access（全权）");

    const withRules = renderPolicyContext({ mode: "workspace-write", workspaceRoot: "/w" }, RULES);
    expect(withRules).toContain("/tmp");
    expect(withRules).toContain("/ro");
    expect(withRules).toContain("**/*.pem");
    // 规则为空时不追加任何一句。
    expect(renderPolicyContext({ mode: "workspace-write", workspaceRoot: "/w" }, empty)).not.toContain(
      "本部署额外授权",
    );
  });

  it("注册在 agent 作用域：装配看到的是我们的文本，全局那条不受影响", async () => {
    const { root, scope } = await mount();
    registerPolicyContext(scope, RULES, () => ({ mode: "workspace-write", workspaceRoot: "/w" }));
    // inject 的回调在依赖就绪后执行；注册本身是同步落在 scope layer 上的，等一个 tick 再装配。
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    // 读装配：服务在 root 上，作用域用 scope key 指定（agent 自己的 ctx 就是这么取它的）。
    const scoped = await root.systemPrompt.assemble({
      agent: fakeAgent(scope),
      scope: keyOf(scope),
    });
    const policy = scoped.contexts.find((entry) => entry.name === SANDBOX_POLICY_CONTEXT);

    expect(policy?.text).toContain("本部署额外授权的可写根：/tmp");
    expect(policy?.text).not.toBe(OFFICIAL_TEXT);

    // 官方那条还在全局层：没有我们的作用域注册时（例如 agentless 装配）照旧是它。
    const global = await root.systemPrompt.assemble({});
    expect(global.contexts.find((entry) => entry.name === SANDBOX_POLICY_CONTEXT)?.text).toBe(
      OFFICIAL_TEXT,
    );
  });

  it("installPolicyContext 在装配时给每个 agent 注册一次", async () => {
    const { root, scope } = await mount();
    installPolicyContext(root, RULES, () => ({ mode: "workspace-write", workspaceRoot: "/w" }));

    const agent = fakeAgent(scope);
    // `systemPrompt.assemble()` 自己就会走 `system-prompt/assemble` 瀑布——第一次装配即触发监听。
    await root.systemPrompt.assemble({ agent, scope: keyOf(scope) });

    const assembled = await root.systemPrompt.assemble({ agent, scope: keyOf(scope) });
    expect(
      assembled.contexts.find((entry) => entry.name === SANDBOX_POLICY_CONTEXT)?.text,
    ).toContain("本部署额外授权的可写根：/tmp");
  });
});
