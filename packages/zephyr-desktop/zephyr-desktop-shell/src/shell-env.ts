// 壳的**外部环境**：整份取登录 shell 的环境，覆盖 GUI 启动给的那份。
//
// macOS 从 Finder / Dock 启动的应用拿到的是 launchd 的最小环境：PATH 只有系统目录（没有 homebrew、
// 没有用户的 `~/.local/bin`），用户在 `~/.zshrc` 里 export 的凭证也读不到。桌面应用是用户环境的
// 延伸：宿主里跑的 pnpm / git / 终端、以及各 provider 的 key，都该与用户在自己的终端里看到的一致
// ——所以同名键**一律以登录 shell 为准**，不判断「缺不缺」：launchd 那份是系统默认值，不可信。
//
// 登录 shell 没给出的键保留（壳自己的部署变量、Electron 注入的键）。
//
// 唯一要守的是**日志**：环境里有大量凭证，日志只能打数量，不能打键名。
import { execFile } from "node:child_process";
import { userInfo } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * 解析 `env -0` 的输出（以 NUL 分隔的 `KEY=VALUE`）。
 * @param output - 原始输出。
 * @returns 键值对。
 */
export function parseEnvDump(output: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const chunk of output.split("\0")) {
    if (chunk === "") continue;
    const at = chunk.indexOf("=");
    if (at <= 0) continue;
    env[chunk.slice(0, at)] = chunk.slice(at + 1);
  }
  return env;
}

/**
 * 默认 shell：**GUI 启动的进程没有 `SHELL`**（launchd 用户域也不设它），只看 `$SHELL` 会在桌面形态
 * 整段跳过 rc；真源是账号的登录 shell（`passwd` 里那一项，`os.userInfo().shell`）。
 * @returns shell 路径，或 `undefined`（账号也没配）。
 */
export function defaultShellPath(): string | undefined {
  const fromEnvironment = process.env.SHELL;
  if (fromEnvironment !== undefined && fromEnvironment !== "") return fromEnvironment;
  const fromAccount = userInfo().shell;
  return fromAccount === null || fromAccount === "" ? undefined : fromAccount;
}

/**
 * 读取登录 shell 的环境（失败即空：这一步是尽力而为，不该让壳起不来）。
 * @param shellPath - 登录 shell（缺省见 {@link defaultShellPath}）。
 * @returns 完整键值对。
 */
export async function loginShellEnv(
  shellPath = defaultShellPath(),
): Promise<Record<string, string>> {
  if (shellPath === undefined || shellPath === "") return {};
  try {
    // `-i` 读 rc 文件（homebrew 的 PATH 与用户 export 都在那里），`-l` 读 profile。零分隔避免值里带空格。
    const { stdout } = await execFileAsync(shellPath, ["-ilc", "env -0"], {
      maxBuffer: 8 * 1024 * 1024,
    });
    return parseEnvDump(stdout);
  } catch {
    return {};
  }
}

/**
 * 用登录 shell 的环境覆盖进程环境：同名键以登录 shell 为准，登录 shell 没给出的键保留。
 * @param target - 目标环境（`process.env`）。
 * @param source - 登录 shell 的环境。
 * @returns 值有变化的键（调用方只该用它计数，**不该把名字打进日志**）。
 */
export function inheritShellEnv(
  target: NodeJS.ProcessEnv,
  source: Readonly<Record<string, string>>,
): string[] {
  const changed: string[] = [];
  for (const [key, value] of Object.entries(source)) {
    if (target[key] !== value) changed.push(key);
    target[key] = value;
  }
  return changed;
}
