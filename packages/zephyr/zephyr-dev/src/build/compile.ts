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
//   · 判据按「**从页面入口可达**」算（{@link reachableModulesOf}）：不可达的产物留在目录里不参与判据，
//     可达链上的缺口一处一处点名（设计决定 12、13）。
//   · 兜底之后仍有缺口 → **构建失败**（{@link assertReachableComplete}）：点名地址 / 引用方 / 副本 /
//     打包器原话——宁可构建红，也不要发一份会白屏的应用。
//   · 收尾两步：可达却缺产物的地址**有副本的按副本补一条目标**再编（决定 9，多版本各出各的），剩下的残余
//     统一指向**共享运行时聚合产物**（决定 8）；聚合产物只许具名导入，出现 default 导入即构建失败（决定 10）。
import { copyFile, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  browserEntryOf,
  BUNDLER_REV,
  cacheKeyOf,
  CLIENT_MODULES_PREFIX,
  dependencyEntry,
  depsUrlOf,
  productFileNameOf,
} from "../federation/bundle.ts";
import {
  prebundleAll,
  type PrebundleFailure,
  type PrebundleTarget,
} from "../federation/prebundle.ts";
import { planPrebundle } from "../federation/prebundle-plan.ts";
import { nodeStubPathOf } from "../internal/package-root.ts";
import { decodePackageName, exportNameOfFileName } from "../internal/resolve.ts";

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
  /** 共享运行时聚合产物的地址（不含 `?v=`）；没有兜底时为空串。 */
  readonly runtime: string;
  /** 被兜底改写到聚合产物的地址。 */
  readonly fallbacks: readonly string[];
}

/** 应用清单里的两项（它们决定应用入口的地址）。 */
interface AppManifest {
  readonly name?: string;
  readonly version?: string;
}

/**
 * 补目标（决定 9）最多迭代几轮。
 *
 * 一轮只补「这一轮看得见的缺口」：补出来的产物自己会引用新的依赖，缺口表因此可能变长。四轮足够覆盖
 * 「产物 → 它的依赖 → 依赖的依赖」这类链；再多说明规则本身不稳定，那时该红，而不是无限补。
 */
const SUPPLEMENT_ROUNDS = 4;

/**
 * 判据读数（从磁盘）：静态目录快照 + 从页面入口出发的 BFS。
 * @param outDir - 静态目录。
 * @param entry - 页面入口地址（{@link entryUrlOf}）。
 * @returns 可达集合与缺口。
 */
async function reachabilityOf(outDir: string, entry: string): Promise<Reachability> {
  const artifacts = new Map(
    (await artifactsOf(outDir)).map((artifact) => [artifact.url, artifact.code]),
  );
  return reachableModulesOf({ entry, artifacts });
}

/**
 * 把应用前端图编译成联邦产物 + 页面骨架。
 * @param options - 工作区、诊断信息与产物落点。
 * @returns 成功条数、失败明细、页面落点、共享运行时地址与被兜底的地址。
 * @throws Error 清单为空、缺 `REQUIRED_PREBUNDLE` 里的已知包、共享运行时聚合产物编不出来，
 *   或共享运行时被 default 导入（都是构建失败，不静默降级）。
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
  const targets: PrebundleTarget[] = [app, ...plan.targets];
  const result = await prebundleAll({
    targets,
    cacheRoot: options.outDir,
    repoRoot: options.workspace,
    nodeStub: nodeStubPathOf(),
    appManifest,
  });
  let built = result.built;
  const failures: PrebundleFailure[] = [...result.failures];
  // 决定 9：**有副本的一律按副本出独立产物**。可达却没有产物的地址里，凡是"包名 + 版本"认得出副本的，
  // 各补一条目标再编（迭代到固定点）——它们不进兜底，否则同名多版本会被合并成一条地址。
  const graph = await reachabilityOf(options.outDir, entryUrlOf(app));
  let gaps = graph.gaps.map((gap) => gap.url);
  const tried = new Set<string>();
  for (let round = 0; round < SUPPLEMENT_ROUNDS; round += 1) {
    const addresses = gaps.filter((url) => !tried.has(url));
    if (addresses.length === 0) break;
    for (const url of addresses) tried.add(url);
    const extra = await supplementTargetsOf({ addresses, known: targets, appManifest });
    if (extra.length === 0) break;
    targets.push(...extra);
    const again = await prebundleAll({
      targets: extra,
      cacheRoot: options.outDir,
      repoRoot: options.workspace,
      nodeStub: nodeStubPathOf(),
      appManifest,
    });
    built += again.built;
    failures.push(...again.failures);
    gaps = (await reachabilityOf(options.outDir, entryUrlOf(app))).gaps.map((gap) => gap.url);
  }
  // 决定 8：剩下的残余统一指向共享运行时聚合产物（编不出来就抛）。
  const sources = new Map(targets.map((target) => [artifactAddressOf(target), target.entry]));
  const fallback = await fallbackToRuntime({
    outDir: options.outDir,
    addresses: gaps,
    appManifest,
    sourceOf: (url) => sources.get(url),
    repoRoot: options.workspace,
    nodeStub: nodeStubPathOf(),
  });
  // 构建中间物不进静态目录：CSS 入口的 shim（`*.css-shim.mjs`）与改写过的 `*.imports.css`
  // 只在这条链内部被 rolldown 读一次，留着就破坏「目录里每个文件都有一个可达地址」。
  await removeBuildScaffolding(options.outDir);
  // 决定 13：兜底之后**重算一次读数**（改写改的是产物字节，可达集合会变），可达集合里还有缺口就红。
  // 不可达的产物留在目录里不动（决定 12）：判据只看可达子集。
  assertReachableComplete({
    reachable: await reachabilityOf(options.outDir, entryUrlOf(app)),
    failures,
    where,
  });
  // 产物侧的清单只留 `rev` + `files`：`resolved` 是「外置依赖解析到哪个包根」的构建期表（**构建机的
  // 绝对路径**），dev 的缓存命中要靠它重放，产物不需要——写进去就是分发一份构建机路径。
  await stripResolvedFromManifests(options.outDir);
  const page = await writePage({ pageEntry, outDir: options.outDir, app });
  return {
    built,
    failures,
    page,
    runtime: fallback.runtime,
    fallbacks: fallback.rewritten,
  };
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
  const entryUrl = entryUrlOf(options.app);
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
 * 页面入口的联邦地址（含 `?v=`）：页面骨架里那一条 script 的 src。
 *
 * 只此一处生成它：可达性判据要从**同一条地址**出发，两处各拼一遍迟早会拼成两个不同的串
 * （`?v=` 一个带一个不带，BFS 就从一条盘上不存在的地址开始）。
 * @param app - 应用入口目标（名字与版本进地址）。
 * @returns 入口地址。
 */
export function entryUrlOf(app: PrebundleTarget): string {
  return `${depsUrlOf(app.name, app.version, "client.js")}?v=${BUNDLER_REV}`;
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

/** 可达性判据的输入。 */
export interface ReachabilityInput {
  /** 页面入口地址（{@link entryUrlOf}，可带 `?v=`）：BFS 的起点。 */
  readonly entry: string;
  /** 静态目录里的产物：地址 → 字节。地址**不含** `?v=`（查询串是缓存世代，不是地址的一部分）。 */
  readonly artifacts: ReadonlyMap<string, string>;
}

/** 一处缺口：**可达**、但静态目录里没有对应产物（浏览器取它就是 404）。 */
export interface ModuleGap {
  /** 缺失的地址。 */
  readonly url: string;
  /** 引用它的产物地址（BFS 顺序；入口自己没有产物时为空）。 */
  readonly importers: readonly string[];
}

/** 判据的读数。 */
export interface Reachability {
  /** 从入口可达的地址（BFS 顺序，含入口本身；**含**那些没有产物的地址）。 */
  readonly reachable: readonly string[];
  /** 可达集合里的缺口（按首次到达顺序）。 */
  readonly gaps: readonly ModuleGap[];
}

/**
 * 产物里的模块说明符：静态 `from "…"`（`import` 与 `export … from`）、副作用 `import "…"`、
 * 动态 `import("…")`。只认这三种「模块位」，不按子串抓地址——产物里还有注释、chunk 名、
 * `new URL(…)` 这类字符串，按子串抓会把它们也算成边。
 */
const MODULE_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/gu;

/**
 * 地址的身份：去掉查询串与哈希（`?v=<构建器指纹>` 一次会话内一致，但不是地址的一部分）。
 * @param url - 引用里写的或清单里算出来的地址。
 * @returns 不含查询串的地址。
 */
function addressOf(url: string): string {
  const cut = url.search(/[?#]/u);
  return cut === -1 ? url : url.slice(0, cut);
}

/**
 * 一段产物里的联邦地址（说明符位上的绝对路径；相对路径、`http(s)`、裸名都不算）。
 * @param code - 产物字节。
 * @returns 地址列表（按出现顺序，保留重复）。
 */
function federationUrlsIn(code: string): string[] {
  const prefix = `${CLIENT_MODULES_PREFIX}/`;
  const out: string[] = [];
  for (const match of code.matchAll(MODULE_SPECIFIER)) {
    const specifier = match[1];
    if (specifier === undefined || !specifier.startsWith(prefix)) continue;
    out.push(addressOf(specifier));
  }
  return out;
}

/**
 * 判据 12：**从页面入口可达**的地址集合，以及它上面的缺口。
 *
 * 为什么不看目录里有什么：静态目录里躺着宿主面的产物（页面永远不加载它们），而「目录里有垃圾」
 * 与「页面会 404」是两件事——只有可达链上的地址才参与判据（设计决定 12）。不可达的产物留在目录里，
 * 不删（那是另一条取舍）。
 *
 * 纯函数：不读盘、不碰 runtime，所以规则可以用手写产物钉住。
 * @param input - 入口地址与产物快照。
 * @returns 可达集合与缺口。
 */
export function reachableModulesOf(input: ReachabilityInput): Reachability {
  /** BFS 队列（只收第一次见到的地址，顺序就是首次到达顺序）。 */
  const pending: string[] = [addressOf(input.entry)];
  const queued = new Set<string>(pending);
  const importersOf = new Map<string, string[]>();
  const reachable: string[] = [];
  const gaps: ModuleGap[] = [];
  for (let index = 0; index < pending.length; index += 1) {
    const url = pending[index];
    if (url === undefined) continue;
    reachable.push(url);
    const code = input.artifacts.get(url);
    if (code === undefined) {
      // 没有产物就没有下一条边：这里如实记缺口，别再往下猜。
      gaps.push({ url, importers: importersOf.get(url) ?? [] });
      continue;
    }
    for (const referenced of federationUrlsIn(code)) {
      const importers = importersOf.get(referenced) ?? [];
      // 同一个产物可能把同一个说明符写两遍（静态 import + 动态 import）：引用方只记一次。
      if (!importers.includes(url)) importers.push(url);
      importersOf.set(referenced, importers);
      if (queued.has(referenced)) continue;
      queued.add(referenced);
      pending.push(referenced);
    }
  }
  return { reachable, gaps };
}

/** 共享运行时聚合产物的**包身份**：虚拟包，不落地为可安装包（设计决定 6）。 */
export const SHARED_RUNTIME_NAME = "@zephyr/shared-runtime";

/** 共享运行时聚合产物的版本段（虚拟包没有版本史：它不出现在任何清单里）。 */
export const SHARED_RUNTIME_VERSION = "0.0.0";

/** 一份落盘产物：地址（不含 `?v=`）、磁盘绝对路径与字节。 */
export interface Artifact {
  /** 联邦地址（{@link artifactAddressOf} 的形态，不含查询串）。 */
  readonly url: string;
  /** 磁盘绝对路径。 */
  readonly file: string;
  /** 字节。资产（图片 / 字体）记空串：判据只跟模块说明符，那里没有 import。 */
  readonly code: string;
}

/**
 * 一个目标的**产物地址**（不含 `?v=`）：地址末段与磁盘文件名同形（{@link productFileNameOf}）。
 * @param target - 一个预编译目标。
 * @returns 联邦地址。
 */
export function artifactAddressOf(target: PrebundleTarget): string {
  const key = cacheKeyOf(target.name, target.version);
  return `${CLIENT_MODULES_PREFIX}/${key}/${productFileNameOf(target.exportName)}`;
}

/**
 * 静态目录里的产物快照：地址 → 磁盘位置与字节。
 *
 * 清单 `.files.json` 是"这个包的产物里有什么"的唯一真相（路由按它服务），所以快照也从它来——
 * 不扫目录猜"哪些文件是产物"。
 * @param outDir - 静态目录。
 * @returns 产物列表（顺序按目录遍历）。
 */
export async function artifactsOf(outDir: string): Promise<Artifact[]> {
  const out: Artifact[] = [];
  for (const entry of await readdir(outDir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || entry.name !== ".files.json") continue;
    const manifest = JSON.parse(
      await readFile(join(entry.parentPath, entry.name), "utf8").catch(() => "{}"),
    ) as { files?: Record<string, string> };
    for (const relative of Object.values(manifest.files ?? {})) {
      const file = join(outDir, relative);
      // 只有 JS 产物里有 import 语句；资产是原字节，读成文本没有意义（也不该被当模块跟下去）。
      const code = relative.endsWith(".js") ? await readFile(file, "utf8").catch(() => "") : "";
      out.push({ url: `${CLIENT_MODULES_PREFIX}/${relative}`, file, code });
    }
  }
  return out;
}

/** 一个产物地址的解剖：哪个包的哪份副本的哪个出口。 */
export interface ModuleAddress {
  /** 包名（`@scope/name`）。 */
  readonly name: string;
  /** 版本（地址里的那一段）。 */
  readonly version: string;
  /** 出口名（包级引用是 `index`）。 */
  readonly exportName: string;
}

/**
 * 产物地址 → 包名 / 版本 / 出口名（{@link artifactAddressOf} 的反向）。
 * @param url - 联邦地址（可带 `?v=`）。
 * @returns 三段；不是联邦地址时 undefined。
 */
export function moduleAddressOf(url: string): ModuleAddress | undefined {
  const prefix = `${CLIENT_MODULES_PREFIX}/`;
  const path = addressOf(url);
  if (!path.startsWith(prefix)) return undefined;
  const [segment, ...rest] = path.slice(prefix.length).split("/");
  if (segment === undefined || rest.length === 0) return undefined;
  // 版本段是**最后一个** `@` 之后：包名里也有 `@`（scope），版本号里没有。
  const at = segment.lastIndexOf("@");
  if (at <= 0) return undefined;
  return {
    name: decodePackageName(segment.slice(0, at)),
    version: segment.slice(at + 1),
    exportName: exportNameOfFileName(rest.join("/")),
  };
}

/** 补目标（决定 9）的输入。 */
export interface SupplementOptions {
  /** 可达、但盘上没有产物的地址。 */
  readonly addresses: readonly string[];
  /** 已经出过产物的目标：它们的 `manifestOf` 指出**哪份副本**（同名多版本各认各的）。 */
  readonly known: readonly PrebundleTarget[];
  /** 应用清单：计划里没有的包（转译器注入、peer），从这里解析副本。 */
  readonly appManifest: string;
}

/**
 * 决定 9：**有副本的一律按副本出独立产物**——为「可达却没有产物」的地址补一条目标。
 *
 * 兜底不是"吞掉多版本"的袋子：`katex@0.16` 与 `katex@0.18` 各是各的副本、各出各的产物（地址里带
 * 各自的版本），合并它们会让其中一个版本的地址永远 404。所以这里先按地址里的"包名 + 版本"去认副本
 * （已出过产物的目标里就有副本清单），认不出再从应用清单解析。两边都认不出的（连副本都没有）才谈得上
 * 兜底（{@link fallbackToRuntime}）。
 * @param options - 缺口地址、已知副本与应用清单。
 * @returns 要补的目标（去重后）。
 */
export async function supplementTargetsOf(options: SupplementOptions): Promise<PrebundleTarget[]> {
  const out: PrebundleTarget[] = [];
  const seen = new Set<string>();
  for (const url of options.addresses) {
    const address = moduleAddressOf(url);
    if (address === undefined) continue;
    const key = `${address.name}@${address.version}/${address.exportName}`;
    if (seen.has(key)) continue;
    const target = await copyTargetOf(address, options);
    if (target === undefined) continue;
    seen.add(key);
    out.push(target);
  }
  return out;
}

/**
 * 一个地址的副本 → 目标：先认"已出过产物的那几份副本"，再退到应用清单。
 *
 * `index` 是包级引用的出口名（地址空间里的缺省），解析时要还原成"包根"这个说明符。
 * @param address - 地址的三段。
 * @param options - 已知副本与应用清单。
 * @returns 目标；解析不到入口时 undefined。
 */
async function copyTargetOf(
  address: ModuleAddress,
  options: SupplementOptions,
): Promise<PrebundleTarget | undefined> {
  const subpath = address.exportName === "index" ? undefined : address.exportName;
  const specifier = subpath === undefined ? address.name : `${address.name}/${subpath}`;
  for (const known of options.known) {
    if (known.name !== address.name || known.version !== address.version) continue;
    if (known.manifestOf === undefined) continue;
    const entry = await browserEntryOf(dirname(known.manifestOf), subpath);
    if (entry === undefined) continue;
    return {
      name: address.name,
      version: address.version,
      exportName: address.exportName,
      entry,
      manifestOf: known.manifestOf,
    };
  }
  const dependency = await dependencyEntry(options.appManifest, specifier);
  // 版本对不上就**不补**：补出来的产物落在另一条地址上，缺口还在（那时它才谈得上兜底）。
  if (dependency === undefined || dependency.version !== address.version) return undefined;
  return {
    name: address.name,
    version: address.version,
    exportName: address.exportName,
    entry: dependency.entry,
    manifestOf: options.appManifest,
  };
}

/** 一次兜底的结果。 */
export interface FallbackResult {
  /** 共享运行时聚合产物的地址（不含 `?v=`）；没有兜底时为空串。 */
  readonly runtime: string;
  /** 聚合产物的成员说明符（`export * from` 的每一条）。 */
  readonly members: readonly string[];
  /** 被改写到 runtime 的地址。 */
  readonly rewritten: readonly string[];
}

/** 兜底的输入。 */
export interface FallbackOptions {
  /** 静态目录。 */
  readonly outDir: string;
  /** 兜底候选：可达、盘上没有产物的地址。 */
  readonly addresses: readonly string[];
  /** 成员说明符的解析基准（应用清单：共享运行时按图根解析）。 */
  readonly appManifest: string;
  /** 产物地址 → 写它的源文件（default 导入要指出源文件；缺省时只报地址）。 */
  readonly sourceOf?: (url: string) => string | undefined;
  /** 仓库根（rolldown 的 cwd 与 alias 基准）。 */
  readonly repoRoot: string;
  /** `node:*` 的浏览器替身。 */
  readonly nodeStub: string;
}

/**
 * 决定 8：把「清单里没有出口」的地址统一指向共享运行时聚合产物，并把它编出来。
 *
 * 聚合产物是**一份虚拟产物**（不落地为可安装包），只出 `index.js`：每个成员一条 `export * from`——
 * 具名导出因此**平铺**到同一个模块上（`export *` 天然不带 default，这正是决定 10 要的形状：
 * 一份模块只有一个 default，两个共享运行时不可能都占它）。
 *
 * 两件事不做：
 * - **不为没有成员的兜底造产物**：连一个成员都解析不到时，把地址指过去只是把 404 换成"导不出这个名字"
 *   的另一种 404——那些地址留在缺口里，由失败面报红（决定 13）。
 * - **不吞多版本**：有副本的地址不走这条路（见 {@link supplementTargetsOf}），这里只收残余。
 * @param options - 产物目录、兜底地址、解析基准与打包参数。
 * @returns 聚合产物地址、成员与改写过的地址。
 * @throws Error 聚合产物编不出来，或共享运行时被 default 导入（决定 10）。
 */
export async function fallbackToRuntime(options: FallbackOptions): Promise<FallbackResult> {
  const addresses = [...new Set(options.addresses.map((url) => addressOf(url)))].filter(
    (url) => url !== "",
  );
  if (addresses.length === 0) return { runtime: "", members: [], rewritten: [] };
  const members = await runtimeMembersOf(addresses, options.appManifest);
  if (members.length === 0) return { runtime: "", members: [], rewritten: [] };
  const runtime = `${CLIENT_MODULES_PREFIX}/${cacheKeyOf(SHARED_RUNTIME_NAME, SHARED_RUNTIME_VERSION)}/index.js`;
  await buildSharedRuntime(options, members);
  const rewritten = await rewriteToRuntime(
    options.outDir,
    addresses,
    `${runtime}?v=${BUNDLER_REV}`,
  );
  const violations = await defaultsOfRuntime({
    outDir: options.outDir,
    runtime,
    ...(options.sourceOf === undefined ? {} : { sourceOf: options.sourceOf }),
  });
  if (violations.length > 0) {
    const detail = violations
      .map((violation) => {
        const source = violation.source === undefined ? "" : `（源文件 ${violation.source}）`;
        return `  ${violation.url} 里的 default 导入 ${violation.local}${source}`;
      })
      .join("\n");
    throw new Error(
      `共享运行时只允许具名导入：聚合产物 ${runtime} 出现了 default 导入。\n${detail}\n` +
        "一份模块只有一个 default，两个共享运行时不可能都占它——改成具名导入（`import { x } from …`）。",
    );
  }
  return { runtime, members, rewritten };
}

/**
 * 兜底地址 → 聚合产物的**成员说明符**：地址反解成 `pkg` 或 `pkg/sub`，能按应用清单解析到入口的才算成员。
 *
 * 成员只收"能装到副本"的那些（peer、转译器注入、上游传递运行时）：连副本都解析不到的地址没有成员可平铺。
 * @param addresses - 兜底地址。
 * @param appManifest - 应用清单（解析基准）。
 * @returns 成员说明符（去重、保持首次出现顺序）。
 */
async function runtimeMembersOf(
  addresses: readonly string[],
  appManifest: string,
): Promise<string[]> {
  const out: string[] = [];
  for (const url of addresses) {
    const address = moduleAddressOf(url);
    if (address === undefined) continue;
    const subpath = address.exportName === "index" ? undefined : address.exportName;
    for (const specifier of subpath === undefined
      ? [address.name]
      : [`${address.name}/${subpath}`, address.name]) {
      if (out.includes(specifier)) break;
      if ((await dependencyEntry(appManifest, specifier)) === undefined) continue;
      out.push(specifier);
      break;
    }
  }
  return out;
}

/**
 * 把聚合产物编出来：往静态目录写一个**合成入口**（成员各一条 `export * from`），交给同一套
 * `bundlePackage` 打，打完把这个构建中间物删掉——静态目录里每个文件都该有一条可达地址。
 * @param options - 产物目录与打包参数。
 * @param members - 成员说明符。
 */
async function buildSharedRuntime(
  options: FallbackOptions,
  members: readonly string[],
): Promise<void> {
  const entry = join(options.outDir, ".shared-runtime.entry.ts");
  await writeFile(
    entry,
    `${members.map((member) => `export * from ${JSON.stringify(member)};`).join("\n")}\n`,
    "utf8",
  );
  try {
    const result = await prebundleAll({
      targets: [
        {
          name: SHARED_RUNTIME_NAME,
          version: SHARED_RUNTIME_VERSION,
          exportName: "index",
          entry,
          manifestOf: options.appManifest,
        },
      ],
      cacheRoot: options.outDir,
      repoRoot: options.repoRoot,
      nodeStub: options.nodeStub,
      appManifest: options.appManifest,
    });
    const [failure] = result.failures;
    if (failure !== undefined) throw new Error(`共享运行时聚合产物编不出来：${failure.reason}`);
  } finally {
    await rm(entry, { force: true });
  }
}

/** 把正则元字符转义（地址里的 `@` `/` `.` 都要按字面匹配）。 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * 已落盘产物里的兜底地址 → 聚合产物地址（连同 `?v=` 一起换）。
 * @param outDir - 静态目录。
 * @param addresses - 兜底地址（不含 `?v=`）。
 * @param runtime - 聚合产物地址（含 `?v=`）。
 * @returns 真的被改写掉的地址。
 */
async function rewriteToRuntime(
  outDir: string,
  addresses: readonly string[],
  runtime: string,
): Promise<string[]> {
  const rewritten = new Set<string>();
  // **聚合产物自己不参与改写**：它的成员就是兜底地址的包，改写它会把某条成员转发换成自引用。
  const self = addressOf(runtime);
  for (const artifact of await artifactsOf(outDir)) {
    if (artifact.code === "" || artifact.url === self) continue;
    let code = artifact.code;
    for (const address of addresses) {
      if (!code.includes(address)) continue;
      // 引用上带着构建器指纹（`?v=<rev>`）：它是缓存世代，改写时一并换掉，别留下半条地址。
      const pattern = new RegExp(`${escapeRegExp(address)}(?:\\?v=[^"'\\s]*)?`, "gu");
      code = code.replace(pattern, runtime);
      rewritten.add(address);
    }
    if (code !== artifact.code) await writeFile(artifact.file, code, "utf8");
  }
  return [...rewritten];
}

/** 一处 default 导入违例（设计决定 10）。 */
export interface DefaultImportViolation {
  /** 引用方的产物地址。 */
  readonly url: string;
  /** 被赋给 default 的本地名（`import React from …` 里的 `React`）。 */
  readonly local: string;
  /** 写这条导入的源文件（能反查到时才有）。 */
  readonly source: string | undefined;
}

/** 产物里的 `import <子句> from "<源>"`（静态导入；动态 `import()` 没有 default 绑定）。 */
const IMPORT_CLAUSE = /\bimport\s+([^;]*?)\s*from\s*["']([^"']+)["']/gu;

/**
 * `import` 子句里的 **default 绑定**（{@link DefaultImportViolation} 的判据）。
 * @param clause - `import` 与 `from` 之间的那段。
 * @returns 本地名；没有 default 绑定时 undefined。
 */
function defaultBindingOf(clause: string): string | undefined {
  const trimmed = clause.trim();
  if (trimmed.startsWith("{")) {
    const braces = trimmed.slice(0, trimmed.indexOf("}") + 1);
    return /\bdefault\s+as\s+([A-Za-z_$][\w$]*)/u.exec(braces)?.[1];
  }
  // 命名空间导入（`* as React`）不是 default。
  if (trimmed.startsWith("*")) return undefined;
  return /^[A-Za-z_$][\w$]*/u.exec(trimmed)?.[0];
}

/**
 * 决定 10：**共享运行时只许具名导入**——产物里出现对聚合产物的 default 导入即算违例。
 *
 * 判据是"对聚合产物的导入"而不是"对某个成员包的导入"：成员各有自己的产物与地址，它们的 default
 * 是它们自己的事；只有聚合产物那**一个** default 位是不能分的。
 * @param options - 产物目录、聚合产物地址与"地址 → 源文件"的反查。
 * @returns 违例清单。
 */
export async function defaultsOfRuntime(options: {
  readonly outDir: string;
  readonly runtime: string;
  readonly sourceOf?: (url: string) => string | undefined;
}): Promise<DefaultImportViolation[]> {
  const out: DefaultImportViolation[] = [];
  for (const artifact of await artifactsOf(options.outDir)) {
    if (artifact.code === "") continue;
    for (const match of artifact.code.matchAll(IMPORT_CLAUSE)) {
      const clause = match[1];
      const source = match[2];
      if (clause === undefined || source === undefined) continue;
      if (addressOf(source) !== options.runtime) continue;
      const local = defaultBindingOf(clause);
      if (local === undefined) continue;
      out.push({ url: artifact.url, local, source: options.sourceOf?.(artifact.url) });
    }
  }
  return out;
}

/**
 * 决定 13：兜底之后，**可达集合**里仍有编不出来的地址 → 构建失败，点名现场。
 *
 * 为什么宁可红：白屏在生产环境里没有任何线索。一条构建期错误能同时给出四样——地址、谁引的、解析到
 * 哪份副本、打包器的原话——四样凑齐才叫「一次定位而不是猜」。
 *
 * 不可达的坏产物不进来：宿主面产物留在目录里是取舍（决定 12），页面根本不加载它。
 * @param options - 判据读数、失败明细与出错现场。
 * @throws Error 有缺口时（逐条点名）。
 */
export function assertReachableComplete(options: {
  readonly reachable: Reachability;
  readonly failures: readonly PrebundleFailure[];
  readonly where: string;
}): void {
  if (options.reachable.gaps.length === 0) return;
  // 缺口地址 → 那条**预编译失败**（副本与打包器原话都在它身上）。地址按产物形态算，与路由同一份。
  const failed = new Map(
    options.failures.map((failure) => [artifactAddressOf(failure.target), failure]),
  );
  const lines = options.reachable.gaps.map((gap) => {
    const failure = failed.get(gap.url);
    const copy =
      failure === undefined
        ? "无副本（连副本都解析不到，或清单里根本没有这个出口）"
        : `${failure.target.name}@${failure.target.version}`;
    const reason =
      failure === undefined ? "（没有对应的预编译目标，打包器没经手过它）" : failure.reason;
    const importers =
      gap.importers.length === 0
        ? "（没有引用方：页面入口自己就没有产物）"
        : gap.importers.join(" ← ");
    return [
      `  ${gap.url}`,
      `    引用方 ${importers}`,
      `    副本 ${copy}`,
      `    打包器 ${reason}`,
    ].join("\n");
  });
  throw new Error(
    [
      `前端产物从页面入口可达的地址里仍有缺口（${String(options.reachable.gaps.length)} 条）：`,
      ...lines,
      `  ${options.where}`,
    ].join("\n"),
  );
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
