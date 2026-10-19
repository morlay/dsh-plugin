import type { LoggerService } from "@deepseek-ai/cordis";
import { SandboxPolicyService } from "@deepseek-ai/dsh-sandbox-policy";
import { Injectable, inject, Logger, type Context } from "@morlay/zephyr";
import { providerContext } from "@morlay/zephyr/compat";
import { fromCordis } from "@morlay/zephyr/compat";
import type { ResolvedConfig } from "./config.ts";
import { ConfigurableFileSystem } from "./fs.ts";
import { installRuntimeContexts } from "./policy.ts";
import { ruleSourceOf, type RuleSource } from "./rules.ts";
import { ConfigurableSandboxProvider } from "./sandbox.ts";

function warnAboutDegradedRules(logger: LoggerService, rules: RuleSource): void {
  const grants = rules.allowWrite.length > 0;
  const readOnly = rules.readOnly.length > 0;
  const denials = rules.deny.length > 0;
  if (!grants && !readOnly && !denials) return;
  if (process.platform === "darwin") return;
  if (readOnly || denials) {
    logger.warn(
      `sandbox-local: "r-" / "--" entries cannot be fully enforced for confined subprocesses on ${process.platform} ` +
        '(Seatbelt enforces both; bwrap binds the path read-only, so "--" degrades to write-only; ' +
        "Landlock and the Windows ACL runner cannot express a subpath rule at all) " +
        "— tools that read through ctx.fs stay covered",
    );
  }
  if (grants && process.platform === "win32") {
    logger.warn(
      'sandbox-local: "rw" entries cannot be granted to confined subprocesses on win32; ' +
        "ctx.fs covers the extra roots, the Windows ACL runner does not",
    );
  }
}

/**
 * 上游 `ConfigurableSandboxProvider` 的适配 Provider：`fromCordis` 负责在行 ctx 上 `new` 它，
 * 服务注册被接管进令牌表/名字视图；`nativeProvide` 让 `ctx.sandbox` 对行内其它插件原生可见。
 */
@Injectable()
export class SandboxService extends fromCordis(ConfigurableSandboxProvider, {
  normalizeConfig: false,
}) {
  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx);
  }
}

/**
 * 上游 `ConfigurableFileSystem` 的适配 Provider；它的 `static inject = ["sandboxPolicy"]`
 * 在 `mount(ctx, deps)` 里显式对齐，依赖关系不藏在 onInit 的 new 里。
 */
@Injectable()
export class FilesystemService extends fromCordis(ConfigurableFileSystem, {
  normalizeConfig: false,
}) {
  policy = inject(SandboxPolicyService);

  protected override async onInit(ctx: Context): Promise<void> {
    await this.mount(ctx, { sandboxPolicy: this.policy });
  }
}

@Injectable()
export class SandboxLocal {
  // 依赖声明：两个上游 Service 适配 Provider + 行策略 + 日志。
  sandbox = inject(SandboxService);

  fs = inject(FilesystemService);

  policy = inject(SandboxPolicyService);

  logger = inject(Logger);

  constructor(private readonly config: ResolvedConfig) {}

  // 行 ctx 上替换 `ctx.sandbox` / `ctx.fs` 两个服务，并接管两条运行时快照。
  // config 是 Loader 用 `Config` 解析后的 ResolvedConfig，`access` 仍是 volatile 引用。
  onInit(ctx: Context): void {
    const config = this.config;
    const rules = ruleSourceOf(config.access.get(), process.env);
    warnAboutDegradedRules(this.logger, rules);
    // 替换了 ctx.sandbox / ctx.fs，`sandbox:policy` 那段运行时文本也要跟着换，`approval:policy` 换成中文
    // （见 policy.ts）。
    installRuntimeContexts(providerContext(ctx), rules, (session) =>
      this.policy.resolve({ session }),
    );
  }
}
