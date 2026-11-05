// CLI 内核：读配置 → 装配清单 → 摆成命令树 → 解析 argv → 执行 → 退出码。
//
// 两段解析是必须的：**要读配置才知道有哪些命令**（插件就在配置里），而配置在哪又得先从 argv 里
// 看出来。所以第一段只认全局 flag（不碰位置参数），第二段在拿到命令树之后再完整解析。
import { stat as statOf } from "node:fs/promises";
import { resolve } from "node:path";
import { bootstrapApplication, type ProviderList } from "@morlay/zephyr";
import { Command } from "./command.ts";
import { loadConfig } from "./config/load.ts";
import { CliError } from "./errors.ts";
import { isLogLevel, LOG_LEVELS, type LogLevel } from "./logger.ts";
import { resolveDataDir } from "./data-dir.ts";
import type { CliModeValues } from "./mode.ts";
import { helpOf, parseParams, type ParamSpecs } from "./params.ts";
import { provideCli } from "./provide.ts";
import { buildCommandTree, childNamesOf, resolveCommand, type CommandNode } from "./tree.ts";

/** 装配上限：超时即失败，不返回半个应用。 */
const BOOTSTRAP_TIMEOUT_MS = 60_000;

/**
 * 全局参数：每条命令都有，内核在装配前就要用到其中一部分。
 *
 * 它们是**内核的参数**而不是某条命令的参数——命令的 `params` 只管自己那一层。
 */
export const GLOBAL_PARAMS: ParamSpecs = {
  config: { kind: "string", description: "工作区配置（缺省 <工作区>/zephyr.config.ts）" },
  dataDir: {
    kind: "enum",
    values: ["workspace", "xdg"],
    allowPath: true,
    description: "数据目录 $DSH_HOME（缺省取配置里的 dataDir，默认 workspace）",
  },
  port: { kind: "number", description: "监听端口" },
  host: { kind: "string", description: "监听地址" },
  logLevel: { kind: "enum", values: LOG_LEVELS, description: "日志阈值（缺省 info）" },
  workspace: { kind: "position", description: "工作区目录（缺省当前目录）" },
};

/** 两个输出流（测试里换成数组收集）。 */
export interface CliStreams {
  readonly stdout?: (line: string) => void;
  readonly stderr?: (line: string) => void;
}

/** 一次运行的外部条件。 */
export interface RunOptions extends CliStreams {
  /** 当前目录（`--config` 与位置参数的基准）。 */
  readonly cwd: string;
}

/**
 * 跑一次 CLI。
 * @param argv - `process.argv.slice(2)`。
 * @param options - 当前目录与输出流。
 * @returns 进程退出码。
 */
export async function runCli(argv: readonly string[], options: RunOptions): Promise<number> {
  const stdout = options.stdout ?? ((line: string) => process.stdout.write(`${line}\n`));
  const stderr = options.stderr ?? ((line: string) => process.stderr.write(`${line}\n`));
  try {
    return await execute(argv, { cwd: options.cwd, stdout, stderr });
  } catch (error) {
    if (error instanceof CliError) {
      stderr(`zephyr: ${error.message}`);
      return error.code;
    }
    stderr(
      `zephyr: 未预期的失败：${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
    return 1;
  }
}

/**
 * 真正的执行：装配之后再做一次完整解析。
 * @param argv - 实参。
 * @param io - 当前目录与两个流。
 * @returns 退出码。
 */
async function execute(
  argv: readonly string[],
  io: {
    readonly cwd: string;
    readonly stdout: (line: string) => void;
    readonly stderr: (line: string) => void;
  },
): Promise<number> {
  const scanned = scanGlobals(argv);
  const workspaceArg = await workspaceOf(scanned.positionals, io.cwd);
  const resolved = await loadConfig({
    cwd: workspaceArg ?? io.cwd,
    ...(scanned.config === undefined ? {} : { configFile: resolve(io.cwd, scanned.config) }),
  });
  const commandTokens =
    workspaceArg === undefined ? scanned.positionals : scanned.positionals.slice(0, -1);
  const dataDirSpec = scanned.dataDir ?? resolved.config.dataDir ?? "workspace";
  // 形态决定装配根：build/preview 跑在闭包上，dev（以及插件自己的命令）跑在源码树上。
  const profileDir =
    commandTokens[0] === "build" || commandTokens[0] === "preview"
      ? resolved.layout.runtime
      : resolved.workspace;
  const mode: CliModeValues = {
    command: commandTokens,
    workspace: resolved.workspace,
    profileDir,
    dataDir: resolveDataDir({ spec: dataDirSpec, profileDir, appName: resolved.appName }),
    dataDirSpec,
    configFile: resolved.configFile,
    ...(scanned.port === undefined ? {} : { port: scanned.port }),
    ...(scanned.host === undefined ? {} : { host: scanned.host }),
  };
  const providers: ProviderList = [
    ...(resolved.config.plugins ?? []),
    ...provideCli({
      mode,
      resolved,
      streams: { stdout: io.stdout, stderr: io.stderr },
      ...(scanned.logLevel === undefined ? {} : { logLevel: scanned.logLevel }),
    }),
  ];
  const app = await bootstrapApplication({ providers, timeoutMs: BOOTSTRAP_TIMEOUT_MS });
  try {
    const tree = buildCommandTree(app.getAll(Command));
    if (commandTokens.length === 0) {
      io.stdout(rootHelpOf(tree));
      return 0;
    }
    const match = resolveCommand(tree, commandTokens);
    if (match === undefined) {
      io.stderr(
        `zephyr: 未知命令 ${commandTokens.join(" ")}（可用: ${childNamesOf(tree).join(" / ")}）`,
      );
      io.stdout(rootHelpOf(tree));
      return 2;
    }
    const specs: ParamSpecs = { ...GLOBAL_PARAMS, ...match.command.params };
    const parsed = parseParams(specs, stripCommand(argv, match.command.path));
    if (parsed.help) {
      io.stdout(
        helpOf({
          path: match.command.path,
          description: match.command.description,
          params: specs,
        }),
      );
      return 0;
    }
    const code = await match.command.run({ params: parsed.values, rest: [], mode });
    return code ?? 0;
  } finally {
    await app.dispose();
  }
}

/** 第一段扫描的结果。 */
interface ScannedGlobals {
  readonly positionals: readonly string[];
  readonly config?: string;
  readonly dataDir?: string;
  readonly port?: number;
  readonly host?: string;
  readonly logLevel?: LogLevel;
}

/**
 * 只认全局 flag 的扫描：**不消费位置参数**（此时还不知道命令名有几段）。
 * @param argv - 实参。
 * @returns 位置参数与各全局 flag。
 */
function scanGlobals(argv: readonly string[]): ScannedGlobals {
  const positionals: string[] = [];
  const found: {
    config?: string;
    dataDir?: string;
    port?: number;
    host?: string;
    logLevel?: LogLevel;
  } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (!arg.startsWith("-")) {
      positionals.push(arg);
      continue;
    }
    const [name, inline] = splitFlag(arg);
    const take = (): string | undefined => {
      if (inline !== undefined) return inline;
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("-")) return undefined;
      index += 1;
      return next;
    };
    switch (name) {
      case "config": {
        const value = take();
        if (value !== undefined) found.config = value;
        break;
      }
      case "data-dir": {
        const value = take();
        if (value !== undefined) found.dataDir = value;
        break;
      }
      case "port": {
        const value = take();
        const parsed = Number(value);
        if (value !== undefined && Number.isFinite(parsed)) found.port = parsed;
        break;
      }
      case "host": {
        const value = take();
        if (value !== undefined) found.host = value;
        break;
      }
      case "log-level": {
        const value = take();
        if (value !== undefined && isLogLevel(value)) found.logLevel = value;
        break;
      }
      default:
        // 未知 flag：不消费下一个 token（它可能是布尔开关）。完整解析时会报用法错误。
        break;
    }
  }
  return { positionals, ...found };
}

/**
 * 工作区位置参数的判定：命令段之后的**最后一个**位置参数，且它确实是一个目录。
 *
 * 命令名段数要到装配后才知道（插件可以加），所以这里用「存在的目录」作为判据；
 * 判错了也只是把路径当命令名，完整解析时会给出明确的报错。
 * @param positionals - 位置参数。
 * @param cwd - 当前目录。
 * @returns 工作区（相对或绝对），或 `undefined`（用当前目录）。
 */
async function workspaceOf(
  positionals: readonly string[],
  cwd: string,
): Promise<string | undefined> {
  if (positionals.length < 2) return undefined;
  const last = positionals[positionals.length - 1];
  if (last === undefined) return undefined;
  try {
    return (await statOf(resolve(cwd, last))).isDirectory() ? last : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 从实参里去掉命令名那几段（它们不该被当成位置参数）。
 * @param argv - 实参。
 * @param path - 命中的命令路径。
 * @returns 去掉命令名之后的实参。
 */
function stripCommand(argv: readonly string[], path: readonly string[]): readonly string[] {
  const out: string[] = [];
  let matched = 0;
  let previousWasValueFlag = false;
  for (const arg of argv) {
    if (previousWasValueFlag) {
      previousWasValueFlag = false;
      out.push(arg);
      continue;
    }
    if (matched < path.length && arg === path[matched]) {
      matched += 1;
      continue;
    }
    out.push(arg);
    previousWasValueFlag = VALUE_GLOBAL_FLAGS.has(arg);
  }
  return out;
}

/** 带值的全局 flag（用于区分「flag 的值」与「位置参数」）。 */
const VALUE_GLOBAL_FLAGS = new Set(["--config", "--data-dir", "--port", "--host", "--log-level"]);

/**
 * `--name=值` 切成名字与值。
 * @param arg - 以 `-` 开头的实参。
 * @returns 名字（不含前导 `--`）与值。
 */
function splitFlag(arg: string): [string, string | undefined] {
  const trimmed = arg.replace(/^--/u, "");
  const at = trimmed.indexOf("=");
  return at < 0 ? [trimmed, undefined] : [trimmed.slice(0, at), trimmed.slice(at + 1)];
}

/**
 * 根帮助：把所有命令的路径与说明列出来。
 * @param tree - 虚拟根。
 * @returns 多行文本。
 */
function rootHelpOf(tree: CommandNode): string {
  const lines = ["用法: zephyr <命令...> [options] [工作区]", "", "命令:"];
  for (const child of tree.children) {
    lines.push(`  ${child.path.join(" ")}  ${child.command?.description ?? ""}`.trimEnd());
  }
  lines.push(
    "",
    "全局选项:",
    "  --config <路径>  工作区配置（缺省 <工作区>/zephyr.config.ts）",
    "  --data-dir <workspace|xdg|路径>  $DSH_HOME",
    "  --port <n> / --host <h>  监听端口与地址",
    "  --log-level <debug|info|warn|error|silent>",
  );
  return lines.join("\n");
}
