// `devkit version <x.y.z|patch|minor|major> [--dry-run]`：把发布集合 bump 到目标版本。
// 包列表由 pnpm 递归给出；`@morlay/dsh-oxc-node` 走独立版本线、private 包不在发布集合，两者都跳过。
import { spawn } from "node:child_process";
import { workspacePackages } from "../workspace/packages.ts";

/** 独立版本线的包：不跟随家族版本（设计「npm 发布线」决定 8）。 */
export const INDEPENDENT_VERSION_PACKAGE = "@morlay/dsh-oxc-node";

/** 精确版本（`X.Y.Z` 加可选预发布）：只有它才能判「已经是目标版本」。 */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:[-+].*)?$/;

function bump(dir: string, args: readonly string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("pnpm", ["version", ...args, "--no-git-tag-version", "--no-git-checks"], {
      cwd: dir,
      stdio: "inherit",
    });
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/**
 * 逐包 bump 发布集合。
 *
 * 已经是目标版本的包直接跳过：`pnpm version` 对「没变」退出 1，串行时会误判整条命令失败。
 * 目标是 `patch` / `minor` 这类语义参数时判不出「是否已到目标」，不做这项跳过。
 *
 * @param root - 仓库根。
 * @param args - 透传给 `pnpm version` 的参数（首个是版本或语义级别）。
 * @returns 首个失败子进程的退出码；全部成功为 0。
 */
export async function run(root: string, args: readonly string[]): Promise<number> {
  const wanted = args[0] ?? "";
  const exact = EXACT_VERSION.test(wanted) ? wanted : undefined;
  for (const pkg of await workspacePackages(root)) {
    const name = String(pkg.manifest["name"]);
    if (pkg.manifest["private"] === true || name === INDEPENDENT_VERSION_PACKAGE) continue;
    if (exact !== undefined && pkg.manifest["version"] === exact) continue;
    const code = await bump(pkg.dir, args);
    if (code !== 0) return code;
  }
  return 0;
}
