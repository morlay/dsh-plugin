import { glob, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { pathExists, runInherited, type UpstreamPaths } from "./common.js";
import { rewriteExports } from "./exports.js";

// `<vendor>/steps.ts` 的两阶段清单（`export const patch` / `export const prebuild`）与执行器；任一步骤
// 失败即失败——上游已变化，评估更新 / 删除 / 新增，不跳过。清单用 TS 写：每条步骤就地注释「为什么」。
//
// - `patch`：改上游工作树（裁剪、打补丁、exports 改写），**从 sync 的干净基线跑一次**；不是所有步骤都
//   幂等（`text` 第二次跑就"未匹配"），重复执行请先 sync。
// - `prebuild`：生成源码面消费的产物（typert 生成物）、编译不得不编译的 native addon、删上游 tsconfig
//   （口径收口）。顺序有依赖：typert 分析靠上游根的 face tsconfig（`tsconfig.host.json` /
//   `tsconfig.client.json`）找贡献者包，删 tsconfig 只能排在它之后——因此重跑同样从 sync 开始。

export type Step =
  | { type: "rm"; path: string }
  | { type: "rm"; glob: string }
  | { type: "text"; file: string; pattern: string; flags?: string; to?: string }
  | { type: "git"; patch: string }
  | {
      type: "exports";
      /** 出口名 → 生成物文件：目标是 `prebuild` 阶段写出的 `.ts`，不是 `lib/*.js`。 */
      generated: Record<string, string>;
      /** 包名 →（出口名 → 源文件）：`lib→src` 同构规则推不出来的出口。 */
      explicit: Record<string, Record<string, string>>;
    }
  | { type: "typert" }
  | { type: "native" };

export type Phase = "patch" | "prebuild";

// 脚本一律用 `pnpm dlx @oxc-node/cli` 驱动（oxc transformer + resolver 直跑 TS），不走 `node --import`。
const OXC_CLI = ["dlx", "@oxc-node/cli"];

// `typert` 步骤：跑**本仓库自己的** typert 生成器（`@local/typert-generator`）——它按 AST 把上游源码的
// 方法面与声明树的类型面合成 `lib/typert.*.ts`。不读上游 tsconfig，也不 import 上游 generator。
//
// 声明树（`target/dts`，由 `@local/devkit` 的 `generateWorkspaceDts` 生成）是它的输入：缺了就先生成一次
// ——同一条链里 `just build` 也要它，共用一份。
async function generateTypertArtifacts(dir: string, root: string): Promise<void> {
  const { generateWorkspaceDts, dtsRootOf } = (await import("@local/dts-prepare")) as {
    generateWorkspaceDts: (root: string) => Promise<void>;
    dtsRootOf: (root: string) => string;
  };
  const { generateTypert } = (await import("@local/typert-generator")) as {
    generateTypert: (options: {
      upstreamRoot: string;
      dtsRoot: string;
      write: boolean;
    }) => Promise<{ package: string; invocations: number }[]>;
  };
  const dtsRoot = dtsRootOf(root);
  if (!(await pathExists(join(dtsRoot, "vendor")))) {
    console.log("[steps] typert: 声明树缺失，先生成一次");
    await generateWorkspaceDts(root);
  }
  const artifacts = await generateTypert({ upstreamRoot: dir, dtsRoot, write: true });
  const invocations = artifacts.reduce((total, artifact) => total + artifact.invocations, 0);
  console.log(
    `[steps] typert: ${artifacts.length} 个包 / ${invocations} 条 invocation —— 已写入 lib/typert.*.ts`,
  );
}

// `native` 步骤：只编**不得不编译**的 addon（`.node` 是二进制产物，源码面消费不了）。其余上游产物都由
// 源码面取代，所以这里直接跑上游自己的 native 构建脚本。
//
// **不经过 `pnpm run`**：上游自带 pnpm workspace，在它目录里跑 pnpm（`run` 在 node_modules 缺失时还会
// **隐式 install**）会造出上游自己的顶层 `node_modules`，与根 workspace 的链接形成双副本——实测让 client
// 测试成片失败，且根 install 不加 `--force` 认不出差别、复不了原。native 构建要的依赖由根 install 提供。
async function buildNativeAddon(dir: string): Promise<void> {
  console.log("[steps] native: native/system/scripts/build.ts --host-addon-only");
  await runInherited(
    "pnpm",
    [...OXC_CLI, "native/system/scripts/build.ts", "--host-addon-only"],
    dir,
  );
}

async function runStep(step: Step, paths: UpstreamPaths): Promise<void> {
  const { dir, patchesRoot } = paths;
  if (step.type === "rm") {
    if ("glob" in step) {
      // 按 glob 删（`rm` 的批量形态）：`fs.glob` 自带展开，不引入 glob 依赖；`node_modules` 永不进范围。
      let removed = 0;
      for await (const entry of glob(step.glob, {
        cwd: dir,
        exclude: (path) => path.includes("node_modules"),
      })) {
        await rm(join(dir, entry), { recursive: true, force: true });
        removed += 1;
      }
      console.log(`[steps] rm ${step.glob}（${removed} 项）`);
      return;
    }
    // 单路径删除：目标不存在即失败——上游把这块挪走 / 改名了，清单该跟着改。
    if (!(await pathExists(join(dir, step.path)))) {
      throw new Error(`rm 目标不存在: ${step.path}（上游已变化，评估本步骤）`);
    }
    console.log(`[steps] rm ${step.path}`);
    await rm(join(dir, step.path), { recursive: true, force: true });
    return;
  }
  if (step.type === "text") {
    const file = join(dir, step.file);
    if (!(await pathExists(file))) throw new Error(`patch 目标不存在: ${step.file}`);
    const content = await readFile(file, "utf8");
    const pattern = new RegExp(step.pattern, step.flags ?? "");
    if (!pattern.test(content)) throw new Error(`patch 正则未匹配: ${step.file}`);
    const next = content.replace(pattern, step.to ?? "");
    if (next === content) throw new Error(`patch 未产生变化: ${step.file}`);
    console.log(`[steps] text ${step.file}`);
    await writeFile(file, next);
    return;
  }
  if (step.type === "git") {
    const patch = join(patchesRoot, step.patch);
    if (!(await pathExists(patch))) throw new Error(`patch 文件不存在: ${patch}`);
    console.log(`[steps] git apply ${step.patch}`);
    await runInherited("git", ["apply", patch], dir);
    return;
  }
  if (step.type === "exports") {
    console.log("[steps] exports -> src");
    await rewriteExports(dir, { generated: step.generated, explicit: step.explicit });
    return;
  }
  if (step.type === "typert") {
    console.log("[steps] typert -> lib/*.ts");
    await generateTypertArtifacts(dir, paths.root);
    return;
  }
  if (step.type === "native") {
    await buildNativeAddon(dir);
    return;
  }
  throw new Error(`未知步骤: ${JSON.stringify(step)}`);
}

// 清单是 TS（`<vendor>/steps.ts`，好让每个阶段、每条步骤旁边写得下为什么）：动态 import 它，按名取阶段。
async function loadPhase(phase: Phase, stepsPath: string): Promise<Step[]> {
  if (!(await pathExists(stepsPath))) {
    console.error(`步骤清单不存在: ${stepsPath}`);
    process.exit(1);
  }
  const module = (await import(pathToFileURL(stepsPath).href)) as Partial<
    Record<Phase, Step[] | undefined>
  >;
  const list = module[phase];
  if (!Array.isArray(list)) {
    console.error(`步骤清单缺 "${phase}" 导出: ${stepsPath}`);
    process.exit(1);
  }
  return list;
}

export async function runPhase(phase: Phase, paths: UpstreamPaths): Promise<void> {
  const list = await loadPhase(phase, paths.stepsPath);
  console.log(`[${phase}] ${list.length} 个步骤 @ ${paths.stepsPath}`);
  for (const step of list) await runStep(step, paths);
}
