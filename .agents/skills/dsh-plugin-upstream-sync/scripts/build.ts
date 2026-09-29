import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathExists, requireWorkspaceEnv, runInherited } from "./common.ts";

// 干净构建完整上游（前置：先跑 patch）：上游目录内 `pnpm install --no-frozen-lockfile` → `pnpm run clean`
// → `pnpm run build`，随后清掉它的 node_modules（`DEEPSEEK_HARNESS_NO_CLEAN=1` 保留）。`clean` 是必需一步：
// `lib/` 不在 git 里、sync 的 reset 清不掉，残留产物会被并行构建当成解析目标。

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
