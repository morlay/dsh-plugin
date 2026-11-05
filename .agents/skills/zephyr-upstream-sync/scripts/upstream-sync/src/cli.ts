#!/usr/bin/env node

// 上游同步链的 CLI：`sync` / `patch` / `prebuild` 三条子命令，对应「日常同步 = sync → patch → prebuild」。
//
// 为什么是包：这里要解析依赖（AST 探查用 `oxc-parser`）。做成包之后依赖写在清单里，`node_modules` 就在它旁边，
// `pnpm dlx @oxc-node/cli .agents/skills/zephyr-upstream-sync/.agents/skills/zephyr-upstream-sync/scripts/upstream-sync/src/cli.ts patch` 一跑就能解析到。
// 包跟着技能走，技能因此自带执行器；项目特化的步骤清单与补丁仍留在 `vendor/`。
//
// 用法（可从任意目录执行——`DEEPSEEK_HARNESS_DIR` 相对 workspace 根解析，不相对 cwd）：
//   pnpm dlx @oxc-node/cli .agents/skills/zephyr-upstream-sync/scripts/upstream-sync/src/cli.ts sync      # 1. 对齐到目标提交
//   pnpm dlx @oxc-node/cli .agents/skills/zephyr-upstream-sync/scripts/upstream-sync/src/cli.ts patch     # 2. steps.ts 的 patch 阶段
//   pnpm dlx @oxc-node/cli .agents/skills/zephyr-upstream-sync/scripts/upstream-sync/src/cli.ts prebuild  # 3. steps.ts 的 prebuild 阶段
import { runPatch } from "./patch.ts";
import { runPrebuild } from "./prebuild.ts";
import { runSync } from "./sync.ts";
import { vendoredDrift, syncVendoredFiles } from "./vendored.ts";
import { upstreamPaths } from "./common.ts";

const COMMANDS: Record<string, () => Promise<void>> = {
  sync: runSync,
  patch: runPatch,
  prebuild: runPrebuild,
  // 按需 vendored 的上游内部文件：复制进各包的 `src/vendor/…`（清单见 `./vendored.ts`）。
  vendor: async () => {
    const written = await syncVendoredFiles(await upstreamPaths());
    console.log(`[vendor] 同步完成：写了 ${String(written)} 份`);
  },
  // CI 用：只比对，不写。
  "vendor-check": async () => {
    const drift = await vendoredDrift(await upstreamPaths());
    if (drift.length === 0) {
      console.log("[vendor] 与上游一致");
      return;
    }
    console.error(`[vendor] ${String(drift.length)} 份与上游不一致：`);
    for (const file of drift) console.error(`  - ${file}`);
    process.exitCode = 1;
  },
};

const name = process.argv[2];
const command = name === undefined ? undefined : COMMANDS[name];
if (command === undefined) {
  console.error(`用法：upstream-sync <${Object.keys(COMMANDS).join("|")}>`);
  process.exit(1);
}
await command();
