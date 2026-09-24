import type { Context } from "@deepseek-ai/cordis";
import { FsError } from "@deepseek-ai/dsh-fs";
import type {
  FsEditOutcome,
  FsEditRequest,
  FsTarget,
  FsVersion,
  FsWriteIntent,
  FsWriteOutcome,
} from "@deepseek-ai/dsh-fs";
import { LocalFileSystem } from "@deepseek-ai/dsh-fs-local";
import { upstreamConfigOf, type ResolvedConfig } from "./config.ts";
import type { SandboxExecutionPolicy, SandboxMode } from "@deepseek-ai/dsh-sandbox";
import type {} from "@deepseek-ai/dsh-sandbox-policy";
import { isPathUnder } from "./containment.ts";
import {
  compileRules,
  isDenied,
  isReadOnly,
  ruleSourceOf,
  writableRootsWith,
  type CompiledRules,
  type RuleSource,
} from "./rules.ts";

export class ConfigurableFileSystem extends LocalFileSystem {
  static inject = ["sandboxPolicy"];

  private readonly defaultMode: SandboxMode;
  private readonly access: ResolvedConfig["access"];

  private readonly compiled = new Map<string, CompiledRules>();

  constructor(ctx: Context, config: ResolvedConfig) {
    super(ctx, upstreamConfigOf(config));
    this.defaultMode = ctx.sandboxPolicy.defaultMode;
    this.access = config.access;
  }

  /** 规则源现场重算：`access` 是 volatile 引用，页面改完下一次编译就是新规则。 */
  private get source(): RuleSource {
    return ruleSourceOf(this.access.get(), process.env);
  }

  override get sandboxMode(): SandboxMode {
    return this.defaultMode;
  }

  override async resolve(
    path: string,
    opts?: { cwd?: string; signal?: AbortSignal },
  ): Promise<FsTarget> {
    const target = await super.resolve(path, opts);
    // 规则里的相对路径相对**会话工作区**解析（`opts.cwd` 只是目标路径的解析基准，见包 README 的条目语法）：
    // 读写两侧同一个基准，读被拒的文件才不会在写路径上被放行。
    this.assertNotDenied(
      this.rulesFor(this.ctx.sandboxPolicy.resolve().workspaceRoot),
      target.targetKey,
      target.displayPath,
    );
    return target;
  }

  override async writeText(
    target: FsTarget,
    content: string,
    expected?: FsWriteIntent,
    signal?: AbortSignal,
    sandboxPolicy?: SandboxExecutionPolicy,
  ): Promise<FsWriteOutcome> {
    return super.writeText(
      await this.checkedTarget(target, sandboxPolicy),
      content,
      expected,
      signal,
    );
  }

  override async editText(
    target: FsTarget,
    edit: FsEditRequest,
    expected?: { version: FsVersion },
    signal?: AbortSignal,
    sandboxPolicy?: SandboxExecutionPolicy,
  ): Promise<FsEditOutcome> {
    return super.editText(await this.checkedTarget(target, sandboxPolicy), edit, expected, signal);
  }

  private assertNotDenied(
    rules: CompiledRules,
    canonicalTarget: string,
    displayPath: string,
  ): void {
    if (!isDenied(rules, canonicalTarget)) return;
    throw new FsError(
      `cannot access "${displayPath}": file access denied by the configured "--" rules`,
      "FS_SANDBOX_DENIED",
    );
  }

  private assertWritable(rules: CompiledRules, canonicalTarget: string, displayPath: string): void {
    this.assertNotDenied(rules, canonicalTarget, displayPath);
    if (!isReadOnly(rules, canonicalTarget)) return;
    throw new FsError(
      `cannot write "${displayPath}": path is read-only by the configured "r-" rule`,
      "FS_SANDBOX_DENIED",
    );
  }

  private async checkedTarget(
    target: FsTarget,
    sandboxPolicy?: SandboxExecutionPolicy,
  ): Promise<FsTarget> {
    const policy = sandboxPolicy ?? this.ctx.sandboxPolicy.resolve();
    const rules = this.rulesFor(policy.workspaceRoot);
    this.assertWritable(rules, target.targetKey, target.displayPath);
    const { mode } = policy;
    if (mode === "danger-full-access") return target;
    if (mode === "read-only") {
      throw new FsError(
        `cannot write "${target.displayPath}": file access denied under read-only mode`,
        "FS_SANDBOX_DENIED",
      );
    }

    const fresh = await super.resolve(target.displayPath);
    this.assertWritable(rules, fresh.targetKey, fresh.displayPath);
    for (const root of writableRootsWith(rules, policy)) {
      if (await isPathUnder(fresh.targetKey, root)) return fresh;
    }
    throw new FsError(
      `cannot write "${target.displayPath}": file access denied under workspace-write mode`,
      "FS_SANDBOX_DENIED",
    );
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

export default ConfigurableFileSystem;
