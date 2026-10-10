import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathExists, requireWorkspaceEnv, runInherited } from "./common.ts";

// 上游构建（前置：先跑 patch）。
//
// **默认只跑「不得不编译」的部分**：`native/system` 的 addon（`.node` 是二进制产物，源码面消费不了）。
// 其余上游产物都由源码面取代——`exports` 指 src、client 半现场打包、typert 生成物由 patch 写成 `.ts`，
// 见 `.agents/adrs/20261010-开发与桌面消费上游源码面而非lib产物.md`。
//
// `--full` 跑原来的完整上游构建（`pnpm run clean` + `pnpm run build`：tsc -b 全仓 + tsdown 全仓 + web 前端），
// 供发布档或上游 built-only 门禁。注意它需要上游自己的 tsconfig——而 patch 会删掉它们，所以 `--full`
// 要在**未 patch 的干净基线**上跑（即 `sync` 之后、`patch` 之前）。
//
// 默认路径**不跑** `pnpm run clean`，也不清 node_modules：那会连 patch 产出的 `lib/*.ts` 与旧前端
// `apps/web/dist` 一起删掉，而源码面还要用各包的 node_modules。

async function main(): Promise<void> {
  const full = process.argv.includes("--full");
  const { root, value: dirValue } = await requireWorkspaceEnv("DEEPSEEK_HARNESS_DIR");
  const dir = resolve(root, dirValue);
  if (!(await pathExists(dir))) {
    console.error(`上游目录不存在: ${dir}（先跑 sync）`);
    process.exit(1);
  }

  if (full) {
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
    console.log(`[build] pnpm install @ ${root}（复原根 workspace 的解析）`);
    await runInherited("pnpm", ["install", "--force"], root);
  } else {
    // 默认路径**不**跑 `pnpm run`：上游目录里 `pnpm` 一旦发现 node_modules 缺失就会触发**隐式 install**，
    // 造出上游自己的顶层 node_modules，与根 workspace 的链接形成双副本（实测会让 client 测试成片失败）。
    // 直接用根目录的 `tsx` 调 native 的构建脚本——它只编译 addon，不碰依赖树。
    console.log(`[build] tsx native/system/scripts/build.ts --host-addon-only @ ${dir}`);
    await runInherited(
      join(root, "node_modules", ".bin", "tsx"),
      ["native/system/scripts/build.ts", "--host-addon-only"],
      dir,
    );
  }
  console.log("[build] done");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
