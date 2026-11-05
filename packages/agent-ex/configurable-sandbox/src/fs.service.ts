// 文件围栏：继承官方 `LocalFileSystem`，在五个写面与 `resolve`（读入口）上叠加本包的规则。
//
// 与官方 `fs-sandbox` 同一威胁模型（受信代码 + 模型可控路径）；内核级隔离仍归 `ctx.sandbox`。
// 规则里的相对路径相对**会话工作区**解析：读写两侧同一个基准，读被拒的文件才不会在写路径上被放行。
import { FsError } from "@morlay/dsh-fs/contract";
import type {
  FsDeleteOutcome,
  FsEditOutcome,
  FsEditRequest,
  FsMoveOutcome,
  FsTarget,
  FsVersion,
  FsWriteIntent,
  FsWriteOutcome,
} from "@morlay/dsh-fs/contract";
import { FileSystemConfig as UpstreamFsConfig, LocalFileSystem } from "@morlay/dsh-fs";
import type { SandboxExecutionPolicy, SandboxMode } from "@morlay/dsh-sandbox/contract";
import { SandboxPolicy } from "@morlay/dsh-sandbox";
import { FileSystem } from "@morlay/dsh-fs";
import { inject, Injectable, type Context } from "@morlay/zephyr";
import { fromCordis } from "@morlay/zephyr/compat";
import { SandboxRules, type SandboxSettings } from "./contract/sandbox-rules.contract.ts";
import { isPathUnder } from "./containment.ts";
import {
  compileRules,
  isDenied,
  isReadOnly,
  writableRootsWith,
  type CompiledRules,
} from "./rules.ts";

// 交给官方基类的配置：它认的两个字段（其余字段是本包自己的）。
export function upstreamFsConfigOf(settings: SandboxSettings) {
  return { cwd: settings.cwd, diffBasisMaxBytes: settings.diffBasisMaxBytes };
}

// 上游构造面的 ctx 类型：直接推导，不把 `@deepseek-ai/cordis` 引成依赖。
type UpstreamFsContext = ConstructorParameters<typeof LocalFileSystem>[0];

// deps 上的名字：上游实例按 `ctx.get("sandboxRules")` / `ctx.get("sandboxPolicy")` 读它们。
const RULES_DEP = "sandboxRules";
const POLICY_DEP = "sandboxPolicy";

export class ConfigurableFileSystem extends LocalFileSystem {
  readonly #rules: SandboxRules;

  readonly #policy: SandboxPolicy;

  readonly #compiled = new Map<string, CompiledRules>();

  constructor(ctx: UpstreamFsContext, config: UpstreamFsConfig) {
    super(ctx, config);
    const read = (ctx as unknown as { get(name: string, strict?: boolean): unknown }).get.bind(ctx);
    this.#rules = read(RULES_DEP) as SandboxRules;
    this.#policy = read(POLICY_DEP) as SandboxPolicy;
  }

  override get sandboxMode(): SandboxMode {
    return this.#policy.defaultMode;
  }

  override async resolve(
    path: string,
    opts?: { cwd?: string; signal?: AbortSignal },
  ): Promise<FsTarget> {
    const target = await super.resolve(path, opts);
    this.#assertNotDenied(
      this.#rulesFor(this.#policy.resolve().workspaceRoot),
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
      await this.#checkedTarget(target, sandboxPolicy),
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
    return super.editText(await this.#checkedTarget(target, sandboxPolicy), edit, expected, signal);
  }

  override async patchText(
    target: FsTarget,
    hunks: Parameters<LocalFileSystem["patchText"]>[1],
    expected?: { version: FsVersion },
    signal?: AbortSignal,
    sandboxPolicy?: SandboxExecutionPolicy,
  ): Promise<FsEditOutcome> {
    return super.patchText(
      await this.#checkedTarget(target, sandboxPolicy),
      hunks,
      expected,
      signal,
    );
  }

  override async deleteFile(
    target: FsTarget,
    expected?: { version: FsVersion },
    signal?: AbortSignal,
    sandboxPolicy?: SandboxExecutionPolicy,
  ): Promise<FsDeleteOutcome> {
    return super.deleteFile(await this.#checkedTarget(target, sandboxPolicy), expected, signal);
  }

  override async moveFile(
    source: FsTarget,
    destination: FsTarget,
    options: Parameters<LocalFileSystem["moveFile"]>[2],
    signal?: AbortSignal,
    sandboxPolicy?: SandboxExecutionPolicy,
  ): Promise<FsMoveOutcome> {
    const checkedSource = await this.#checkedTarget(source, sandboxPolicy);
    const checkedDestination = await this.#checkedTarget(destination, sandboxPolicy);
    return super.moveFile(checkedSource, checkedDestination, options, signal);
  }

  #assertNotDenied(rules: CompiledRules, canonicalTarget: string, displayPath: string): void {
    if (!isDenied(rules, canonicalTarget)) return;
    throw new FsError(
      `cannot access "${displayPath}": file access denied by the configured "--" rules`,
      "FS_SANDBOX_DENIED",
    );
  }

  #assertWritable(rules: CompiledRules, canonicalTarget: string, displayPath: string): void {
    this.#assertNotDenied(rules, canonicalTarget, displayPath);
    if (!isReadOnly(rules, canonicalTarget)) return;
    throw new FsError(
      `cannot write "${displayPath}": path is read-only by the configured "r-" rule`,
      "FS_SANDBOX_DENIED",
    );
  }

  // 先过本包规则，再过官方模式围栏：`r-` / `--` 优先于可写根，但不放松 `read-only`。
  async #checkedTarget(
    target: FsTarget,
    sandboxPolicy?: SandboxExecutionPolicy,
  ): Promise<FsTarget> {
    const policy = sandboxPolicy ?? this.#policy.resolve();
    const rules = this.#rulesFor(policy.workspaceRoot);
    this.#assertWritable(rules, target.targetKey, target.displayPath);
    if (policy.mode === "danger-full-access") return target;
    if (policy.mode === "read-only") {
      throw new FsError(
        `cannot write "${target.displayPath}": file access denied under read-only mode`,
        "FS_SANDBOX_DENIED",
      );
    }

    const fresh = await super.resolve(target.displayPath);
    this.#assertWritable(rules, fresh.targetKey, fresh.displayPath);
    for (const root of writableRootsWith(rules, policy)) {
      if (await isPathUnder(fresh.targetKey, root)) return fresh;
    }
    throw new FsError(
      `cannot write "${target.displayPath}": file access denied under workspace-write mode`,
      "FS_SANDBOX_DENIED",
    );
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
export class ConfigurableFsSandbox extends fromCordis(FileSystem, ConfigurableFileSystem) {
  // 注入字段必须是**普通属性**：装配期回填注入走 Object.keys(instance)，# 私有字段不可见。
  private readonly rulesSource = inject(SandboxRules);

  private readonly sandboxPolicyFace = inject(SandboxPolicy);

  override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, upstreamFsConfigOf(this.rulesSource.settings()), {
      [RULES_DEP]: this.rulesSource,
      [POLICY_DEP]: this.sandboxPolicyFace,
    });
  }
}
