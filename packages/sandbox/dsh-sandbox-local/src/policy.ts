import type { Agent } from "@deepseek-ai/dsh-agent";
import type { Context } from "@deepseek-ai/cordis";
import type { SandboxExecutionPolicy } from "@deepseek-ai/dsh-sandbox";
import type { Session } from "@deepseek-ai/dsh-session";
import type {} from "@deepseek-ai/dsh-system-prompt";
import type { RuleSource } from "./rules.ts";

/**
 * 接管 `sandbox:policy` 那条运行时上下文。
 *
 * 上游 [`@deepseek-ai/dsh-sandbox-policy`] 在**全局层**注册它，文本只描述官方策略（只读 /
 * workspace-write / 全权 + workspace root）——它不知道本部署追加的 `rw` / `r-` / `--` 规则，
 * 模型因此拿不到"哪些额外路径可写、哪些被拒"。本包替换了 `ctx.sandbox` / `ctx.fs`，这条文本也得跟着换。
 *
 * 全局层同名注册会抛错（`NamedEntries.insert`），上游给的官方路径是**按 agent 作用域覆盖**：
 * `systemPrompt.context()` 在 scope 上注册同名项，装配时近的作用域遮蔽全局那条
 * （`ScopedLayers.merge`）。所以这里在每个 agent 的 `ctx` 上注册一次。
 */

/** 上游注册的运行时上下文名：同名才叫接管。 */
export const SANDBOX_POLICY_CONTEXT = "sandbox:policy";

/**
 * 策略文本：官方三种 mode 的语义（重写中文，与其它注入文案一致）+ 本部署追加的规则。
 * @param policy - 该会话解析出来的策略（模式与 workspace root）。
 * @param rules - 本部署解析后的访问规则（已展开环境变量模板）。
 * @returns 给模型看的一段文本。
 */
export function renderPolicyContext(policy: SandboxExecutionPolicy, rules: RuleSource): string {
  const base = ((): string => {
    switch (policy.mode) {
      case "read-only":
        return "当前 DSH 文件策略：只读。任何可用的操作都不能修改 standing 模式下的文件。别仅凭这条策略就拒绝必需的修改：照常尝试可用工具，并遵循它给出的拒绝与升级指引。";
      case "workspace-write":
        return `当前 DSH 文件策略：workspace-write（工作区可写）。任何可用的操作都可修改会话工作区 ${JSON.stringify(policy.workspaceRoot)} 下的文件；部分平台临时目录同样可写。`;
      case "danger-full-access":
        return "当前 DSH 文件策略：danger-full-access（全权）。DSH 文件沙箱不再限制可用操作对文件的修改。";
    }
  })();

  const extras: string[] = [];
  if (rules.allowWrite.length > 0) {
    extras.push(`本部署额外授权的可写根：${rules.allowWrite.join("、")}。`);
  }
  if (rules.readOnly.length > 0) {
    extras.push(`只读（一律不可写）：${rules.readOnly.join("、")}。`);
  }
  if (rules.deny.length > 0) {
    extras.push(`拒绝访问（读与写都拒）：${rules.deny.join("、")}。`);
  }
  return extras.length === 0 ? base : `${base} ${extras.join("")}`;
}

/**
 * 在给定作用域注册同名策略文本（agent 的 `ctx`，或 preset 子树）。
 * @param scope - 拥有这次注册的 ctx；它的 scope 因此遮蔽全局那条。
 * @param rules - 本部署的访问规则。
 * @param resolve - 按会话解析策略（生产传 `ctx.sandboxPolicy.resolve`）。
 */
export function registerPolicyContext(
  scope: Context,
  rules: RuleSource,
  resolve: (session: Session) => SandboxExecutionPolicy,
): void {
  // 回调参数 ctx 才是解锁了 `systemPrompt` 的那个 ctx，注册也就落在它的 scope 上。
  scope.inject(["systemPrompt"], (scoped) => {
    scoped.systemPrompt.context({
      name: SANDBOX_POLICY_CONTEXT,
      order: scoped.systemPrompt.getContextOrder("SANDBOX_POLICY"),
      text: (context) => {
        const session = context.agent?.session;
        return session === undefined ? "" : renderPolicyContext(resolve(session), rules);
      },
    });
  });
}

/**
 * 每个 agent 注册一次（装配期做，与 scope 出口同一时机与理由：创建期服务可用性还在变）。
 * @param ctx - 本插件的 ctx（host 平面）。
 * @param rules - 本部署的访问规则。
 * @param resolve - 按会话解析策略。
 */
export function installPolicyContext(
  ctx: Context,
  rules: RuleSource,
  resolve: (session: Session) => SandboxExecutionPolicy,
): void {
  const registered = new WeakSet<Agent>();
  ctx.on("system-prompt/assemble", (_assembly, context, next) => {
    const agent = context.agent as Agent | undefined;
    if (agent !== undefined && !registered.has(agent)) {
      registered.add(agent);
      registerPolicyContext(agent.ctx, rules, resolve);
    }
    return next();
  });
}
