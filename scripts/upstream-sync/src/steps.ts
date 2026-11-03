import { glob, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { pathExists, runInherited, type UpstreamPaths } from "./common.ts";
import { rewriteExports } from "./exports.ts";

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
  | { type: "native" }
  | { type: "cua-native" }
  | { type: "client-meta" };

export type Phase = "patch" | "prebuild";

// 脚本一律用 `pnpm dlx @oxc-node/cli` 驱动（oxc transformer + resolver 直跑 TS），不走 `node --import`。
const OXC_CLI = ["dlx", "@oxc-node/cli"];

// `typert` 步骤：跑**本仓库自己的** typert 生成器（`@local/typert-generator`）——它按 AST 把上游源码的
// 方法面与声明树的类型面合成 `lib/typert.*.ts`。不读上游 tsconfig，也不 import 上游 generator。
//
// 声明树（`target/dts`）的生成与并发锁收在 `@local/dts-prepare`，由生成器自己确保（与 tsdown 的
// `repoRootOf(cwd) → ensureWorkspaceDts → dtsRootOf` 同一条流程）：这条步骤不再有"先跑一个 dts 子命令"
// 的前置，也不自己判断声明树在不在。
async function generateTypertArtifacts(dir: string): Promise<void> {
  const { generateTypert } = (await import("@local/typert-generator")) as {
    generateTypert: (options: {
      upstreamRoot: string;
      write: boolean;
    }) => Promise<{ package: string; invocations: number }[]>;
  };
  const artifacts = await generateTypert({ upstreamRoot: dir, write: true });
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

// `cua-native` 步骤：Computer Use 的 native 载荷（macOS 应用包）。它也是"不得不编译"的二进制，但产物形态
// 是**发布包**才带的 `native/bin/darwin-<arch>/`（上游把它写进了 `.gitignore`）：
//
// - **源码树 dev** 走 `.build/prepared/<arch>/` 现场编译（`native-build.ts` 的 `isSourcePackage` 分支），
//   所以没有它 dev 也能跑；
// - **装进 app 的闭包**是"已安装"形态（`isSourcePackage` 为 false），只认 `native/bin/darwin-<arch>/current.json`。
//
// 不在这里构建的话，包能装上、用户点开 CUA 才炸（`dshdev desktop bundle` 会在缺它时报错）。只有 macOS 能产，
// 别的平台**跳过**（上游也只支持 darwin）——CI 跑在 ubuntu 上，这一步在那里什么都不做。
async function buildCuaNative(dir: string): Promise<void> {
  if (process.platform !== "darwin") {
    console.log(`[steps] cua-native: 跳过（上游只产 macOS 载荷，当前 ${process.platform}）`);
    return;
  }
  // 没有 Xcode 的机器产不出这份载荷，也不该因此拦下日常 prepare（`dshdev desktop bundle` 会在打包时再拦）。
  if (!(await pathExists("/usr/bin/xcrun"))) {
    console.log("[steps] cua-native: 跳过（没有 xcrun：这台机器没装 Xcode）");
    return;
  }
  const packageRoot = join(dir, "packages/experimental/cua-macos");
  const script = join(packageRoot, "native/build_app.py");
  if (!(await pathExists(script))) {
    throw new Error(`cua-native 目标不存在: ${script}（上游已变化，评估本步骤）`);
  }
  const architecture = process.arch === "x64" ? "x86_64" : "arm64";
  console.log(`[steps] cua-native: native/build_app.py --arch ${architecture}`);
  try {
    // 与 `native` 同理**不经过 pnpm run**（会在上游目录里造出第二份 node_modules）；构建要的依赖由根 install 提供。
    await runInherited("/usr/bin/xcrun", ["python3", script, "--arch", architecture], packageRoot);
  } catch (error: unknown) {
    // **失败不拦 prepare**：这份载荷只影响桌面打包里的 Computer Use 一行，而 `dshdev desktop bundle` 会在
    // 缺它时 fail loud（不会产出打不开的包）。常见原因是这台机器没有完整 Xcode，或跑在受限 sandbox 里
    // （SwiftPM 自己要用 `sandbox-exec`，报 `sandbox_apply: Operation not permitted`）。
    const detail = String(error instanceof Error ? error.message : error).split("\n")[0] ?? "";
    console.warn(
      `[steps] cua-native: 构建失败，跳过（${detail}）；桌面打包前请单独跑 just native-cua`,
    );
  }
}

// `client-meta` 步骤：上游的**浏览器版本元数据**（版本 / commit / 工作区是否 dirty）由它自己的
// `scripts/client-build-environment.ts` 定义，产物写在仓库根的 `.dsh-build/client-build-environment.json`。
// 前端设置页的版本行与侧栏的 `<commit>-dirty` 读的就是它——所以我们**不自己定义**这几个值，只是把上游那份
// 生成器跑一次（`patch` 阶段把整个 `scripts/` 裁掉了，那是上游自用脚本；这里从 git 里取回这一个文件）。
//
// 记录里上游还带 `artifacts`（client 产物 digest）：我们的 client 产物是**运行时按需构建**的，构建期不存在，
// 所以只写 `environment` 那半（字段名与 formatVersion 跟着上游）。
const CLIENT_META_SCRIPT = `import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repositoryClientBuildEnvironment } from "../scripts/client-build-environment.ts";

const root = process.argv[2];
if (root === undefined) throw new Error("usage: write-client-build-environment.ts <vendor root>");
const environment = { ...repositoryClientBuildEnvironment(root), DSH_CLIENT_BUILD_PROFILE: "local" };
const directory = join(root, ".dsh-build");
mkdirSync(directory, { recursive: true });
writeFileSync(join(directory, "client-build-environment.json"),
  \`\${JSON.stringify({ formatVersion: 1, environment }, undefined, 2)}\n\`);
console.log(\`[steps] client-meta \${JSON.stringify(environment)}\`);
`;

async function writeClientBuildMeta(dir: string): Promise<void> {
  await runInherited("git", ["checkout", "HEAD", "--", "scripts/client-build-environment.ts"], dir);
  const directory = join(dir, ".dsh-build");
  const script = join(directory, "write-client-build-environment.ts");
  await mkdir(directory, { recursive: true });
  await writeFile(script, CLIENT_META_SCRIPT);
  try {
    await runInherited("pnpm", [...OXC_CLI, script, dir], dir);
  } finally {
    await rm(script, { force: true });
    // 取回来的那个源文件用完就删：`scripts/` 是裁过的，别留一份孤立文件。
    await rm(join(dir, "scripts"), { recursive: true, force: true });
  }
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
    await generateTypertArtifacts(dir);
    return;
  }
  if (step.type === "native") {
    await buildNativeAddon(dir);
    return;
  }
  if (step.type === "cua-native") {
    await buildCuaNative(dir);
    return;
  }
  if (step.type === "client-meta") {
    console.log("[steps] client-meta: scripts/client-build-environment.ts");
    await writeClientBuildMeta(dir);
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
