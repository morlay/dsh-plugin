import type { Context } from "@deepseek-ai/cordis";
import type { ConfinedArgv, SandboxPolicy } from "@deepseek-ai/dsh-sandbox";
import { LocalSandboxProvider } from "@deepseek-ai/dsh-sandbox-local";
import { upstreamConfigOf, type ResolvedConfig } from "./config.ts";
import { extendConfinedArgv } from "./dialects.ts";
import {
  compileRules,
  isEmptyRules,
  ruleSourceOf,
  withoutAllowRoots,
  type CompiledRules,
  type RuleSource,
} from "./rules.ts";

export class ConfigurableSandboxProvider extends LocalSandboxProvider {
  private readonly access: ResolvedConfig["access"];

  private readonly compiled = new Map<string, CompiledRules>();

  constructor(ctx: Context, config: ResolvedConfig) {
    // 上游基类读的是**值**：装配事实在页面上只读可见，改它们要重挂这一行（重挂后重新解析）。
    super(ctx, upstreamConfigOf(config));
    this.access = config.access;
  }

  /** 规则源现场重算：`access` 是 volatile 引用，页面改完下一次编译就是新规则。 */
  private get source(): RuleSource {
    return ruleSourceOf(this.access.get(), process.env);
  }

  override async confine(
    argv: readonly string[],
    policy: SandboxPolicy,
    signal?: AbortSignal,
  ): Promise<ConfinedArgv> {
    const confined = await super.confine(argv, policy, signal);
    const rules = this.rulesFor(policy.workspaceRoot);
    const effective = policy.mode === "workspace-write" ? rules : withoutAllowRoots(rules);
    if (isEmptyRules(effective)) return confined;
    return { ...confined, argv: extendConfinedArgv(confined.argv, effective) };
  }

  /** 编译结果按「工作区 + 当前 access」缓存：access 是页面可改的引用，改了就是另一份规则。 */
  private rulesFor(workspaceRoot: string): CompiledRules {
    const access = this.access.get();
    const key = `${workspaceRoot}\u0000${JSON.stringify(access ?? null)}`;
    const cached = this.compiled.get(key);
    if (cached !== undefined) return cached;
    const compiled = compileRules(ruleSourceOf(access, process.env), workspaceRoot);
    this.compiled.set(key, compiled);
    return compiled;
  }
}

export default ConfigurableSandboxProvider;
