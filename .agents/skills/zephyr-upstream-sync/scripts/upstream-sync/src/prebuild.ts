import { join } from "node:path";
import { pathExists, upstreamPaths } from "./common.ts";
import { runPhase } from "./steps.ts";

// 构建前的准备：跑 `<vendor>/steps.ts` 的 `prebuild` 阶段——生成源码面消费的产物（typert 生成物）、
// 编译不得不编译的 native addon、删上游 tsconfig（口径收口）。
//
// 前置是 sync + patch 的干净基线：typert 分析靠上游根的 face tsconfig 找贡献者包，而本阶段末尾会把
// tsconfig 删掉——重跑请从 sync 开始（整条链几分钟内跑完）。
//
// 上游代码本身**不再 build**：`exports` 指 src、client 半现场打包、typert 产物由这里写成 `.ts`
// （决策见 `.agents/adrs/20261010-开发与桌面消费上游源码面而非lib产物.md`）。

export async function runPrebuild(): Promise<void> {
  const paths = await upstreamPaths();
  if (!(await pathExists(join(paths.dir, ".git")))) {
    console.error(`上游目录不存在或非 git 仓库: ${paths.dir}（先跑 sync 与 patch）`);
    process.exit(1);
  }
  await runPhase("prebuild", paths);
  console.log("[prebuild] done");
}
