import type { Volatile } from "@deepseek-ai/cosmokit";
import z from "@deepseek-ai/schemastery";
import type { Config as UpstreamFsConfig } from "@deepseek-ai/dsh-fs-local";
import type { Config as UpstreamSandboxConfig } from "@deepseek-ai/dsh-sandbox-local";

export interface Config extends UpstreamSandboxConfig, UpstreamFsConfig {
  access?: string | string[];
}

/**
 * schema 解析之后的形状：`access` 是 **volatile 稳定引用**（页面可改的那一项），读它要过 `.get()`。
 *
 * 其余字段也是 volatile，但页面把它们画成**只读**（schema 上的 `disabled()`）：它们是装配事实——runner 命令、
 * 进程 cwd、上游基类读一次的超时与差额上限——放在页面上是为了看清「这一行现在装配成什么样」，改它们要重挂
 * 这一行。所以给上游基类的那份配置是**解包后的值**（{@link upstreamConfigOf}）：基类读的是值，不是引用。
 */
export interface ResolvedConfig extends Omit<
  Config,
  | "access"
  | "runnerCommand"
  | "runnerFailureSignatures"
  | "probeTimeoutMs"
  | "cwd"
  | "diffBasisMaxBytes"
> {
  readonly access: Volatile<string | string[]>;
  readonly runnerCommand: Volatile<readonly string[]>;
  readonly runnerFailureSignatures: Volatile<readonly string[]>;
  readonly probeTimeoutMs: Volatile<number>;
  readonly cwd: Volatile<string>;
  readonly diffBasisMaxBytes: Volatile<number>;
}

/**
 * 本地化说明：`description()` 的类型签名只声明 `string`，而 meta 本身接受 `Dict<string>`
 * （`vendor/schemastery/src/index.ts` 的 `mergeDesc` 就是按字典合并的），所以这里只做一次类型放行。
 */
const localized = (text: { zh: string; en: string }): string => text as unknown as string;

export const Config: z<Config, ResolvedConfig> = z.object({
  access: z
    .union([z.array(z.string()), z.string()])
    .default([])
    .description(
      localized({
        zh:
          "额外可写根与拒绝项，一行一条：`rw:<路径>` 追加可写根，`r-:<路径>` 只读，`--:<路径>` 拒绝；" +
          "支持 `~`、环境变量与 glob。改它当场生效（沙箱规则每次按当前值重算），不用重挂这一行。",
        en:
          "Extra writable roots and refusals, one entry per line: `rw:<path>` grants a writable root, " +
          "`r-:<path>` makes it read-only, `--:<path>` denies it; `~`, env templates, and globs are supported. " +
          "Edits take effect on the next rule compile without remounting the row.",
      }),
    )
    .volatile(),
  runnerCommand: z
    .array(z.string())
    .default([])
    .disabled()
    .description(
      localized({
        zh: "沙箱 runner 的启动命令；空数组表示按平台自带的链去选。改它要重挂这一行。",
        en: "Runner command for confined subprocesses; an empty array picks the platform chain. Edits apply on remount.",
      }),
    )
    .volatile(),
  runnerFailureSignatures: z
    .array(z.string())
    .default([])
    .disabled()
    .description(
      localized({
        zh: "runner 命令「用不了」的判定片段，与 `runnerCommand` 成对出现。",
        en: "Fragments that mark the runner command unusable; declared together with `runnerCommand`.",
      }),
    )
    .volatile(),
  probeTimeoutMs: z
    .natural()
    .default(5_000)
    .disabled()
    .description(
      localized({
        zh: "探测 runner 可用性的超时（毫秒）。",
        en: "Timeout in ms for probing whether the runner works.",
      }),
    )
    .volatile(),
  cwd: z
    .string()
    .default(process.cwd())
    .disabled()
    .description(
      localized({
        zh: "相对路径的基准目录；默认是启动这个进程时的工作目录。",
        en: "Base directory for relative paths; defaults to the process working directory.",
      }),
    )
    .volatile(),
  diffBasisMaxBytes: z
    .number()
    .default(10 * 1024 * 1024)
    .disabled()
    .description(
      localized({
        zh: "覆盖写差异的单侧字节上限（默认 10 MiB）。",
        en: "Per-side byte cap for overwrite diffs (10 MiB by default).",
      }),
    )
    .volatile(),
});

/**
 * 交给上游基类的那份配置：装配事实取当前值。
 *
 * 上游 `LocalSandboxProvider` / `LocalFileSystem` 在构造时读一次这些字段并做装配期校验，所以它们要的是值；
 * 设置页改它们走的是「写盘 → Loader 重挂这一行 → 重新解析」这条路。
 * @param config - 本行解析后的配置。
 * @returns 上游两个基类认的普通配置对象。
 */
export function upstreamConfigOf(config: ResolvedConfig): UpstreamSandboxConfig & UpstreamFsConfig {
  return {
    runnerCommand: [...config.runnerCommand.get()],
    runnerFailureSignatures: [...config.runnerFailureSignatures.get()],
    probeTimeoutMs: config.probeTimeoutMs.get(),
    cwd: config.cwd.get(),
    diffBasisMaxBytes: config.diffBasisMaxBytes.get(),
  };
}
