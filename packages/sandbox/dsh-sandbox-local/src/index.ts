import type { Context } from "@deepseek-ai/cordis";
import type { Config } from "./config.ts";
import { ConfigurableFileSystem } from "./fs.ts";
import { installPolicyContext } from "./policy.ts";
import { ruleSourceOf, type RuleSource } from "./rules.ts";
import { ConfigurableSandboxProvider } from "./sandbox.ts";

export { Config } from "./config.ts";

export const name = "sandbox-local";

export const inject = ["sandboxPolicy"];

function warnAboutDegradedRules(ctx: Context, rules: RuleSource): void {
  const grants = rules.allowWrite.length > 0;
  const readOnly = rules.readOnly.length > 0;
  const denials = rules.deny.length > 0;
  if (!grants && !readOnly && !denials) return;
  if (process.platform === "darwin") return;
  if (readOnly || denials) {
    ctx.logger.warn(
      `sandbox-local: "r-" / "--" entries cannot be fully enforced for confined subprocesses on ${process.platform} ` +
        '(Seatbelt enforces both; bwrap binds the path read-only, so "--" degrades to write-only; ' +
        "Landlock and the Windows ACL runner cannot express a subpath rule at all) " +
        "— tools that read through ctx.fs stay covered",
    );
  }
  if (grants && process.platform === "win32") {
    ctx.logger.warn(
      'sandbox-local: "rw" entries cannot be granted to confined subprocesses on win32; ' +
        "ctx.fs covers the extra roots, the Windows ACL runner does not",
    );
  }
}

export function apply(ctx: Context, config: Config): void {
  const rules = ruleSourceOf(config, process.env);
  warnAboutDegradedRules(ctx, rules);
  new ConfigurableSandboxProvider(ctx, config);
  new ConfigurableFileSystem(ctx, config);
  // 替换了 ctx.sandbox / ctx.fs，`sandbox:policy` 那段运行时文本也要跟着换（见 policy.ts）。
  installPolicyContext(ctx, rules, (session) => ctx.sandboxPolicy.resolve({ session }));
}
