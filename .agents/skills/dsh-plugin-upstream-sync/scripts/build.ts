import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathExists, requireWorkspaceEnv, runInherited } from "./common.ts";

// 干净构建完整上游（构建前置：需先跑 patch）。约定：
//   env DEEPSEEK_HARNESS_DIR 上游目录，相对 pnpm-workspace.yaml 所在根
//   env DEEPSEEK_HARNESS_NO_CLEAN 设 1 时保留 node_modules（默认清理）
// 在上游目录内 pnpm install && pnpm run clean && pnpm run build，随后清理其 node_modules。
//
// `pnpm run clean` 是必需一步，不是优化：`lib/` 产物不受 git 约束（`.gitignore` 里），
// sync 的 reset 清不掉它们。残留的上一版 `lib/` 会被并行构建的别的包当成解析目标
// （rolldown 按 package.json exports 读 lib，而非 tsconfig path 指到的 src），
// 于是「上游新增了一个导出」这类改动在本机表现为 MISSING_EXPORT 构建失败，
// 而在干净 clone 的 CI 上正常。清理语义由上游自己的 clean 脚本给。
// 可从任意目录执行。

async function main(): Promise<void> {
  const { root, value: dirValue } = await requireWorkspaceEnv("DEEPSEEK_HARNESS_DIR");
  const dir = resolve(root, dirValue);
  if (!(await pathExists(dir))) {
    console.error(`上游目录不存在: ${dir}（先跑 sync）`);
    process.exit(1);
  }

  console.log(`[build] pnpm install --no-frozen-lockfile @ ${dir}`);
  await runInherited("pnpm", ["install", "--no-frozen-lockfile"], dir);
  console.log(`[build] pnpm run clean @ ${dir}`);
  await runInherited("pnpm", ["run", "clean"], dir);
  console.log(`[build] pnpm run build @ ${dir}`);
  await runInherited("pnpm", ["run", "build"], dir);

  if (process.env.DEEPSEEK_HARNESS_NO_CLEAN !== "1") {
    console.log(`[build] clean node_modules @ ${dir}`);
    await rm(join(dir, "node_modules"), { recursive: true, force: true });
  }
  console.log("[build] done");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
