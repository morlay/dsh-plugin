import { execFile, spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

// 公共：workspace / 上游路径解析 + 异步进程 / 文件系统小工具。`DEEPSEEK_HARNESS_DIR` 相对
// pnpm-workspace.yaml（workspace 根）解析，不相对 `process.cwd()`。

// 同步数据（`steps.ts` 与 `patches/`）就住在上游 clone 的**父目录**里——`vendor/` 是仓库维护的
// 那一层，上游 clone 自己那份 `patches/`（pnpm patchedDependencies）与它无关。
export type UpstreamPaths = {
  root: string; // workspace 根（pnpm-workspace.yaml 所在目录）
  dir: string; // 上游仓库
  stepsPath: string;
  patchesRoot: string;
};

const execFileAsync = promisify(execFile);

// existsSync 的异步等价物：stat 失败（不存在 / 不可访问）即 false。
export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// execFileSync(..., { encoding: "utf8" }) 的异步等价物：捕获 stdout。
export async function execFileCapture(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<string> {
  const { stdout } = await execFileAsync(command, args, { cwd, encoding: "utf8" });
  return stdout;
}

type CommandFailure = Error & { status: number | null; signal: NodeJS.Signals | null };

// 与 node 的 execFileSync 失败文案保持一致（"Command failed: <cmd> <args>"）。
function commandFailed(
  command: string,
  args: readonly string[],
  code: number | null,
  signal: NodeJS.Signals | null,
): CommandFailure {
  return Object.assign(new Error(`Command failed: ${command} ${args.join(" ")}`), {
    status: code,
    signal,
  });
}

// execFileSync(..., { stdio: "inherit" }) 的异步等价物：stdio 直连终端，非零退出 / 信号 / 启动失败都以 reject 表达。
export async function runInherited(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<void> {
  await new Promise<void>((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", rejectRun);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      rejectRun(commandFailed(command, args, code, signal));
    });
  });
}

export async function workspaceRootOf(start: string): Promise<string> {
  let dir = resolve(start);
  for (;;) {
    if (await pathExists(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error("找不到 pnpm-workspace.yaml（从执行目录向上）——无法确定 workspace 根");
    }
    dir = parent;
  }
}

export async function requireWorkspaceEnv(name: string): Promise<{ root: string; value: string }> {
  const value = process.env[name];
  if (!value || value.length === 0) {
    console.error(`需要环境变量 ${name}`);
    process.exit(1);
  }
  return { root: await workspaceRootOf(process.cwd()), value };
}

export async function upstreamPaths(): Promise<UpstreamPaths> {
  const { root, value } = await requireWorkspaceEnv("DEEPSEEK_HARNESS_DIR");
  const dir = resolve(root, value);
  const vendor = dirname(dir);
  return {
    root,
    dir,
    stepsPath: join(vendor, "steps.ts"),
    patchesRoot: join(vendor, "patches"),
  };
}
