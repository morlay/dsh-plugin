// 工作区包的发现：只问 pnpm（`pnpm -r --filter` 的递归），工具里不自己遍历目录。
// 构建、发布、验收三处都从这里取包列表，避免各自维护一份「哪些是包」的规则。
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** 发布集合所在的两层目录：`packages/<family>/<pkg>`。包的定义仍以 pnpm 的 workspace 配置为准。 */
export const PACKAGES_FILTER = "./packages/*/*";

/** 一个工作区包：目录与清单原样（字段由调用方按需解释）。 */
export interface WorkspacePackage {
  readonly dir: string;
  readonly manifest: Record<string, unknown>;
}

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function run(command: string, args: readonly string[], cwd: string): Promise<RunResult> {
  return new Promise((done) => {
    const child = spawn(command, [...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", (error) => done({ code: 1, stdout, stderr: String(error) }));
    child.on("close", (code) => done({ code: code ?? 1, stdout, stderr }));
  });
}

/**
 * 列出工作区的每个包（按包名排序）。
 *
 * 包列表来自 `pnpm -r --filter` 的两层 glob（见 {@link PACKAGES_FILTER}）：每个包在自己的目录里跑一次，
 * 打一行 JSON 回到这里。pnpm 的告警也走 stdout，所以只认 `{` 开头的行。
 *
 * @param root - 仓库根（pnpm 从这里找 workspace 配置）。
 * @returns 包目录与清单。
 */
export async function workspacePackages(root: string): Promise<WorkspacePackage[]> {
  const result = await run(
    "pnpm",
    ["-r", "--filter", PACKAGES_FILTER, "exec", "node", join(here, "package-info.ts")],
    root,
  );
  if (result.code !== 0) {
    throw new Error(
      "workspacePackages: pnpm -r exec 失败\n" + (result.stderr.trim() || result.stdout.trim()),
    );
  }
  const packages: WorkspacePackage[] = [];
  for (const line of result.stdout.split("\n")) {
    const text = line.trim();
    if (!text.startsWith("{")) continue;
    packages.push(JSON.parse(text) as WorkspacePackage);
  }
  return packages.sort((left, right) =>
    String(left.manifest["name"]).localeCompare(String(right.manifest["name"])),
  );
}
