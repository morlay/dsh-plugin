import { join } from "node:path";
import { pathExists, upstreamPaths } from "./common.ts";
import { runPhase } from "./steps.ts";

// 给上游工作树打本地补丁：跑 `<vendor>/steps.ts` 的 `patch` 阶段（裁剪、git apply、exports 改写）。
//
// 前置是 sync 的**干净基线**——不是所有步骤都幂等（`text` 第二次跑就"未匹配"），重复执行请先 sync。
// 可从任意目录执行：`DEEPSEEK_HARNESS_DIR` 与步骤清单都相对 workspace 根解析。

export async function runPatch(): Promise<void> {
  const paths = await upstreamPaths();
  if (!(await pathExists(join(paths.dir, ".git")))) {
    console.error(`上游目录不存在或非 git 仓库: ${paths.dir}（先跑 sync）`);
    process.exit(1);
  }
  await runPhase("patch", paths);
  console.log("[patch] done");
}
