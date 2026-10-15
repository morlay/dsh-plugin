// 上游同步链的 CLI：`sync` / `patch` / `prebuild` 三条子命令，对应「日常同步 = sync → patch → prebuild」。
//
// 为什么是包而不是技能目录里的散脚本：这里要解析依赖（AST 探查用 `oxc-parser`）。散脚本住在 `.agents/skills/`
// 下、不属于任何包，`node_modules` 里什么都没有；做成 devpackage 之后依赖写在清单里，`pnpm dlx @oxc-node/cli
// devpackages/upstream-sync/src/cli.ts patch` 一跑就能解析到（脚本所在目录向上就是它的 `node_modules`）。
//
// 用法（可从任意目录执行——`DEEPSEEK_HARNESS_DIR` 相对 workspace 根解析，不相对 cwd）：
//   pnpm dlx @oxc-node/cli devpackages/upstream-sync/src/cli.ts sync      # 1. 对齐到目标提交
//   pnpm dlx @oxc-node/cli devpackages/upstream-sync/src/cli.ts patch     # 2. steps.ts 的 patch 阶段
//   pnpm dlx @oxc-node/cli devpackages/upstream-sync/src/cli.ts prebuild  # 3. steps.ts 的 prebuild 阶段
import { runPatch } from "./patch.ts";
import { runPrebuild } from "./prebuild.ts";
import { runSync } from "./sync.ts";

const COMMANDS: Record<string, () => Promise<void>> = {
  sync: runSync,
  patch: runPatch,
  prebuild: runPrebuild,
};

const name = process.argv[2];
const command = name === undefined ? undefined : COMMANDS[name];
if (command === undefined) {
  console.error(`用法：upstream-sync <${Object.keys(COMMANDS).join("|")}>`);
  process.exit(1);
}
await command();
