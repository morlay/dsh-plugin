// 构建器的**前端预编译面**：`compile(options)`——应用 client 入口的静态 import 图 → 一堆联邦产物。
// 无 ctx、无装配：build 阶段没有运行期行树，也不该有。
//
// 判据（T4 从 CLI 搬来时一字未改）：
//   · 清单来自 `planPrebundle`（应用 client 入口的静态 import 图）；
//   · `REQUIRED_PREBUNDLE` 是三个已知包的断言，缺一个即失败；
//   · 清单为空 / 缺已知包 → 抛错；逐条 `bundlePackage` 的失败汇总进结果，由调用方决定红；
//   · 产物落在调用方给的 `outDir`：dev 传 `<dataDir>/cache/client-modules`，
//     build 传 `<outputDir>/client_modules`——**同一语义、只换目录**（设计决定 7）。
//   · 页面上那一个 `index.html` 也在这里落盘：入口 script 改写成应用入口的**联邦地址**，
//     于是 `outDir` 是一份纯静态目录（设计决定 5、9）。
import { copyFile, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BUNDLER_REV, depsUrlOf } from "../federation/bundle.ts";
import {
  prebundleAll,
  type PrebundleFailure,
  type PrebundleTarget,
} from "../federation/prebundle.ts";
import { planPrebundle } from "../federation/prebundle-plan.ts";
import { nodeStubPathOf } from "../internal/package-root.ts";

/**
 * 必须出现在清单里的包：它们的 client 入口是页面骨架的一部分，缺了就说明枚举规则漏了（不是可选集）。
 *
 * `shiki` 是这条规则最硬的样本：它只装在 `@deepseek-ai/dsh-client-ui-primitives` 的 `node_modules` 里，
 * 应用清单既看不见、也没声明它。枚举因此要下潜到 `@deepseek-ai/dsh-client*` 并按**引用方**解析包根
 * （见 `prebundle-plan.ts`）；少任何一半，它就从清单里静默消失。
 *
 * 这条断言**不跟着放宽**：放宽它等于把「清单不完整」变成静默降级。
 */
export const REQUIRED_PREBUNDLE = [
  "@morlay/zephyr-app",
  "@morlay/dsh-conversation",
  "shiki",
] as const;

/** 一次预编译的输入。 */
export interface CompileOptions {
  /** 工作区（应用根：`package.json` 与 `src/client` 都在它下面）。 */
  readonly workspace: string;
  /** 应用名（诊断用：失败时说明是哪个应用的 client 图）。 */
  readonly appName: string;
  /**
   * 前端产物的落点：**静态目录**（`index.html` + 按包联邦产物 + `.files.json`）。
   *
   * 由调用方决定传哪个目录（设计决定 7：同一语义、只换目录）——dev 传数据根下的缓存，
   * build 传 `<outputDir>/client_modules`。这里不认识任何一种部署值。
   */
  readonly outDir: string;
  /**
   * 页面骨架（应用的 `index.html`）；缺省 `<workspace>/src/client/index.html`。
   *
   * 它是**页面入口**（`client.entry` 指的也是它）：复制进 `outDir`，并把入口 script 改写成
   * 应用入口的联邦地址——页面从此只知道一个 URL，不知道源码在哪。
   */
  readonly pageEntry?: string;
}

/** 一次预编译的结果：成功条数与失败明细（空清单 / 缺已知包是**抛错**，不进这里）。 */
export interface CompileResult {
  /** 成功条数。 */
  readonly built: number;
  /** 失败明细（调用方决定红：CLI 翻成 `CliError`）。 */
  readonly failures: readonly PrebundleFailure[];
  /** 页面骨架的落点（`<outDir>/index.html`）。 */
  readonly page: string;
}

/** 应用清单里的两项（它们决定应用入口的地址）。 */
interface AppManifest {
  readonly name?: string;
  readonly version?: string;
}

/**
 * 把应用前端图编译成联邦产物 + 页面骨架。
 * @param options - 工作区、诊断信息与产物落点。
 * @returns 成功条数、失败明细与页面落点。
 * @throws Error 清单为空，或缺 `REQUIRED_PREBUNDLE` 里的已知包（都是构建失败，不静默降级）。
 */
export async function compile(options: CompileOptions): Promise<CompileResult> {
  const appManifest = join(options.workspace, "package.json");
  const clientEntry = join(options.workspace, "src", "client", "app-boot.ts");
  const pageEntry = options.pageEntry ?? join(options.workspace, "src", "client", "index.html");
  const manifest = JSON.parse(await readFile(appManifest, "utf8")) as AppManifest;
  const plan = await planPrebundle({ entry: clientEntry });
  const where = diagnosticOf(options, clientEntry);
  if (plan.targets.length === 0) {
    throw new Error(`前端预编译清单为空：静态 import 图里没枚举到任何目标。\n  ${where}`);
  }
  const missing = REQUIRED_PREBUNDLE.filter(
    (name) => !plan.targets.some((target: PrebundleTarget) => target.name === name),
  );
  if (missing.length > 0) {
    throw new Error(`前端预编译清单缺已知包：${missing.join(", ")}\n  ${where}`);
  }
  // **应用入口自己也是一个联邦目标**（设计 §三 的 `<app>@<ver>/client.js`）：页面骨架只认地址，
  // 入口产物与按包产物同形——静态目录里没有"特殊的那一个文件"。
  const app = appTargetOf(manifest, clientEntry, appManifest);
  const result = await prebundleAll({
    targets: [app, ...plan.targets],
    cacheRoot: options.outDir,
    repoRoot: options.workspace,
    nodeStub: nodeStubPathOf(),
    appManifest,
  });
  // 构建中间物不进静态目录：CSS 入口的 shim（`*.css-shim.mjs`）与改写过的 `*.imports.css`
  // 只在这条链内部被 rolldown 读一次，留着就破坏「目录里每个文件都有一个可达地址」。
  await removeBuildScaffolding(options.outDir);
  // 产物侧的清单只留 `rev` + `files`：`resolved` 是「外置依赖解析到哪个包根」的构建期表（**构建机的
  // 绝对路径**），dev 的缓存命中要靠它重放，产物不需要——写进去就是分发一份构建机路径。
  await stripResolvedFromManifests(options.outDir);
  const page = await writePage({ pageEntry, outDir: options.outDir, app });
  return { built: result.built, failures: result.failures, page };
}

/**
 * 应用入口作为联邦目标：名字取应用**包名**、版本取应用版本（地址与磁盘目录用同一对值）。
 * @param manifest - 应用清单。
 * @param entry - `src/client/app-boot.ts` 的绝对路径。
 * @param manifestOf - 应用清单的绝对路径（外置依赖的版本表从它建）。
 * @returns 目标。
 * @throws Error 应用清单缺 `name` 或 `version`（地址里的两段都没有来源）。
 */
export function appTargetOf(
  manifest: AppManifest,
  entry: string,
  manifestOf: string,
): PrebundleTarget {
  if (manifest.name === undefined || manifest.version === undefined) {
    throw new Error(`应用清单缺 name 或 version：应用入口的联邦地址要靠它们（${manifestOf}）。`);
  }
  return {
    name: manifest.name,
    version: manifest.version,
    exportName: "client",
    entry,
    manifestOf,
  };
}

/**
 * 页面骨架落盘：复制 `index.html` 进静态目录，并把**入口 script** 改写成应用入口的联邦地址。
 *
 * 改写规则（与 dev 期同一条）：页面里那个 `type="module"` 且 src 是本地相对路径的 script 就是入口
 * ——dev 由 `ServeDefault.replyPage` 把它换成 `/@fs/<绝对路径>`（交付方决定入口在哪），
 * prod 由这里换成联邦地址 `/_zephyr/@modules/<app>@<ver>/client.js?v=<BUNDLER_REV>`。
 * 两边都只做「本地入口 → 交付地址」这一件事，所以规则一致：**不看它原来指向哪个文件**。
 * @param options - 页面原文路径、产物目录与入口目标。
 * @returns 写出的页面路径。
 * @throws Error 页面里找不到本地入口 script（静默通过会产出一个「永远白屏」的静态目录）。
 */
export async function writePage(options: {
  readonly pageEntry: string;
  readonly outDir: string;
  readonly app: PrebundleTarget;
}): Promise<string> {
  const html = await readFile(options.pageEntry, "utf8");
  const entryUrl = `${depsUrlOf(options.app.name, options.app.version, "client.js")}?v=${BUNDLER_REV}`;
  const rewritten = html.replace(
    /(<script\b[^>]*\btype="module"[^>]*\bsrc=")(\.{1,2}\/[^"]*)(")/u,
    (_whole: string, head: string, _src: string, tail: string) => `${head}${entryUrl}${tail}`,
  );
  if (rewritten === html) {
    throw new Error(
      `页面骨架里找不到本地入口 script（type="module" + 相对 src）：${options.pageEntry}`,
    );
  }
  const page = join(options.outDir, "index.html");
  await copyFile(options.pageEntry, page);
  await writeFile(page, rewritten, "utf8");
  return page;
}

/**
 * 删掉构建中间物：CSS 入口的 shim 与它改写过的 `.imports.css`。
 *
 * 它们是 `bundlePackage` 的输入，不是产物——静态目录里每个文件都该有一个可达地址。
 * @param outDir - 静态目录。
 */
async function removeBuildScaffolding(outDir: string): Promise<void> {
  for (const entry of await readdir(outDir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    if (!/\.(css-shim\.mjs|imports\.css)$/u.test(entry.name)) continue;
    await rm(join(entry.parentPath, entry.name), { force: true });
  }
}

/**
 * 去掉产物清单里的 `resolved`（构建机的绝对路径表）。
 * @param outDir - 静态目录。
 */
async function stripResolvedFromManifests(outDir: string): Promise<void> {
  for (const entry of await readdir(outDir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || entry.name !== ".files.json") continue;
    const path = join(entry.parentPath, entry.name);
    const manifest = JSON.parse(await readFile(path, "utf8")) as {
      rev?: string;
      files?: Record<string, string>;
    };
    const trimmed = { rev: manifest.rev, files: manifest.files };
    await writeFile(path, `${JSON.stringify(trimmed, null, 2)}\n`, "utf8");
  }
}

/**
 * 失败时那行上下文：哪个应用、从哪个入口枚举、产物落哪。
 *
 * 为什么要它：同一个失败在 dev（数据根缓存）与 build（产物目录）下要改的东西不同；
 * 只打入口路径时读的人还得自己把这几件事拼起来。
 * @param options - 预编译输入。
 * @param clientEntry - 枚举起点。
 * @returns 一行诊断。
 */
function diagnosticOf(options: CompileOptions, clientEntry: string): string {
  return `应用 ${options.appName} · 入口 ${clientEntry} · 产物落 ${options.outDir}`;
}
