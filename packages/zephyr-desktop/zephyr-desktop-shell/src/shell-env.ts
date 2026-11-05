// 壳的**外部环境**：从登录 shell 取一份完整环境，补上 GUI 启动缺的东西。
//
// macOS 从 Finder / Dock 启动的应用拿到的是 launchd 的最小环境（PATH 里没有 homebrew、没有用户的
// `~/.local/bin`，也读不到用户在 `~/.zshrc` 里 export 的凭证）。桌面应用是用户环境的延伸：宿主里跑的
// pnpm / git / 终端、以及各 provider 的 key，都需要这份环境——所以这里**全量继承**。
//
// 唯一要守的是**日志**：环境里有大量凭证，日志只能打数量，不能打键名。
import { execFile } from "node:child_process";
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
 * 读取登录 shell 的环境（失败即空：这一步是尽力而为，不该让壳起不来）。
 * @param shellPath - 登录 shell（缺省 `$SHELL`）。
 * @returns 完整键值对。
 */
export async function loginShellEnv(
  shellPath = process.env.SHELL,
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
 * 把登录 shell 的环境补进进程环境：**只补缺失的键**（用户显式给的不覆盖）。
 * @param target - 目标环境（缺省 `process.env`）。
 * @param source - 登录 shell 的环境。
 * @returns 补进去的键数（调用方只该用它计数，**不该把名字打进日志**）。
 */
export function mergeMissingEnv(
  target: NodeJS.ProcessEnv,
  source: Readonly<Record<string, string>>,
): string[] {
  const filled: string[] = [];
  for (const [key, value] of Object.entries(source)) {
    if (target[key] !== undefined && target[key] !== "") continue;
    target[key] = value;
    filled.push(key);
  }
  return filled;
}
