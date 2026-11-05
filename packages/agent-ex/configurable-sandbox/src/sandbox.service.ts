// 进程沙箱：底座是官方 `LocalSandboxProvider`，本类在它的 `confine` 结果上追加本包的规则。
//
// 形态与 `@morlay/dsh-sandbox` 的 `SandboxDefault` 一致：`fromCordis(契约, 上游类)` 包装。上游类是
// cordis `Service` —— `mount` 用根 ctx 构造它（`super(ctx, "sandbox")` 在那里注册），所以装配面
// `without(SandboxDefault)` 之后本行是 `sandbox` 的唯一提供者。规则与配置经 `mount` 的 deps 交给上游实例：
// 它按 `ctx.get("sandboxRules")` 读到的是这份契约面，不是全局单例。
import type { ConfinedArgv } from "@morlay/dsh-sandbox/contract";

/** 基类 `confine` 的第二个参数类型：按覆盖签名推导，避免与契约别名在可选字段上的差异。 */
type SandboxConfinePolicy = Parameters<LocalSandboxProvider["confine"]>[1];
import {
  LocalSandboxConfig as UpstreamSandboxConfig,
  LocalSandboxProvider,
} from "@morlay/dsh-sandbox";
import { Sandbox } from "@morlay/dsh-sandbox";
import { inject, Injectable, Logger, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { SandboxRules, type SandboxSettings } from "./contract/sandbox-rules.contract.ts";
import { extendConfinedArgv } from "./dialects.ts";
import {
  compileRules,
  isEmptyRules,
  withoutAllowRoots,
  type CompiledRules,
  type RuleSource,
} from "./rules.ts";

// 上游构造面的 ctx 类型：直接推导，不把 `@deepseek-ai/cordis` 引成依赖。
type UpstreamSandboxContext = ConstructorParameters<typeof LocalSandboxProvider>[0];

// deps 上的名字：上游实例按 `ctx.get("sandboxRules")` 读它（`fromCordis` 的 deps 替换读面）。
const RULES_DEP = "sandboxRules";

// 交给官方基类的配置：它认的三个字段（其余字段是本包自己的）。
export function upstreamConfigOf(settings: SandboxSettings) {
  return {
    runnerCommand: [...settings.runnerCommand],
    runnerFailureSignatures: [...settings.runnerFailureSignatures],
    probeTimeoutMs: settings.probeTimeoutMs,
  };
}

// 官方提供者 + 规则追加。构造面与官方一致（`(ctx, config)`），规则从 deps 注入的读面取。
export class ConfigurableSandboxProvider extends LocalSandboxProvider {
  // `#` 私有：与包在外面的 Provider 字段不会撞名（TS 的 `private` 会）。
  readonly #rules: SandboxRules;

  readonly #compiled = new Map<string, CompiledRules>();

  constructor(ctx: UpstreamSandboxContext, config: UpstreamSandboxConfig) {
    super(ctx, config);
    this.#rules = (ctx as unknown as { get(name: string, strict?: boolean): unknown }).get(
      RULES_DEP,
    ) as SandboxRules;
  }

  override async confine(
    argv: readonly string[],
    policy: SandboxConfinePolicy,
    signal?: AbortSignal,
  ): Promise<ConfinedArgv> {
    const confined = await super.confine(argv, policy, signal);
    const rules = this.#rulesFor(policy.workspaceRoot);
    // `rw` 只在 `workspace-write` 下生效：显式选定的只读边界不因额外可写根放松。
    const effective = policy.mode === "workspace-write" ? rules : withoutAllowRoots(rules);
    if (isEmptyRules(effective)) return confined;
    return { ...confined, argv: extendConfinedArgv(confined.argv, effective) };
  }

  // 规则源是启动时读一次的那份：按工作区缓存编译结果。
  #rulesFor(workspaceRoot: string): CompiledRules {
    const cached = this.#compiled.get(workspaceRoot);
    if (cached !== undefined) return cached;
    const compiled = compileRules(this.#rules.source(), workspaceRoot);
    this.#compiled.set(workspaceRoot, compiled);
    return compiled;
  }
}

@Injectable()
export class ConfigurableSandbox extends fromCordis(Sandbox, ConfigurableSandboxProvider) {
  // 注入字段必须是**普通属性**：装配期回填注入走 Object.keys(instance)，# 私有字段不可见。
  private readonly rulesSource = inject(SandboxRules);

  private readonly loggerFace = inject(Logger);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, upstreamConfigOf(this.rulesSource.settings()), {
      [RULES_DEP]: this.rulesSource,
    });
    this.#warnAboutDegradedRules(this.rulesSource.source());
  }

  // 装配期告警：平台表达不了的条目点名说明（不静默失效）。
  #warnAboutDegradedRules(rules: RuleSource): void {
    const grants = rules.allowWrite.length > 0;
    const readOnly = rules.readOnly.length > 0;
    const denials = rules.deny.length > 0;
    if (!grants && !readOnly && !denials) return;
    if (process.platform === "darwin") return;
    if (readOnly || denials) {
      this.loggerFace.warn(
        `configurable-sandbox: "r-" / "--" entries cannot be fully enforced for confined subprocesses on ${process.platform} ` +
          '(Seatbelt enforces both; bwrap binds the path read-only, so "--" degrades to write-only; ' +
          "Landlock and the Windows ACL runner cannot express a subpath rule at all) " +
          "— tools that read through ctx.fs stay covered",
      );
    }
    if (grants && process.platform === "win32") {
      this.loggerFace.warn(
        'configurable-sandbox: "rw" entries cannot be granted to confined subprocesses on win32; ' +
          "ctx.fs covers the extra roots, the Windows ACL runner does not",
      );
    }
  }
}
