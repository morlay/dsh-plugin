// 包清单（`exports` / `publishConfig.exports`）由构建从产物推导并写回 `package.json`，不手写：
// 顶层出口指源码（workspace 内直连 `src`），发布态指产物；client 半发布态是 **ESM 库**（它那份 CJS
// 工厂由 boot 按路径加载，进出口）。
// 出口约定与理由见 `.agents/standards/how-to-write.md` 的「包出口」一节。
import { readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { TsdownHooks } from "tsdown";

// tsdown `build:done` 钩子；上下文与产物块类型都从 tsdown 自己的定义取，不手抄一份。
type BuildDoneHook = TsdownHooks["build:done"];

export interface PackageExportsOptions {
  // 入口名 → 源码路径（`index` 是包根出口 `.`）。
  readonly entries: Record<string, string>;
  // client 半的入口名；有它时该出口按 **ESM 库**写（工厂形态不进出口，见 `pickLibrary`）。
  readonly clientEntry?: string;
  // 只构建、不导出的入口名（产物要落位，但不该成为包的门面）。
  readonly hidden?: readonly string[];
  // 命令名 → 入口名：`bin` 两侧一起写（顶层指源码、发布态指产物）。
  readonly bin?: Record<string, string>;
  // 额外写 Node / Electron 的传统入口 `main` / `module`（都指包根出口的产物）：这类消费方不看
  // `exports`——Electron 以包目录为 app 启动时按 `main` 找主进程入口，缺了它退回 `index.js` 并报错。
  readonly legacy?: boolean;
  // 声明文件名的来源。声明不再由 tsdown 产出（见 `dts.ts`），所以由调用方按同一套命名规则给出；
  // 缺省时才回落到「从 tsdown 的产物块里收」。
  readonly declarationFiles?: (entry: string) => readonly string[];
}

const PACKAGE_JSON_EXPORT = "./package.json";
const PATCH_EXPORT = "./cordis.patch.yml";
const LOCALE_EXPORT = "./locale/*.json";

// 构建环境里的上游版本常量（`mise.toml` 的 `DEEPSEEK_HARNESS_VERSION`）：装配面的 dsh 要求由它推导。
const HARNESS_VERSION_ENV = "DEEPSEEK_HARNESS_VERSION";

// `X.Y.Z` 加可选 pre-release / build 后缀；其余形态（含 `workspace:`）不认。
const SEMANTIC_VERSION = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u;

/**
 * 装配面（清单里声明了 `dsh.bundle.patch` 的包）要写的 `engines.dsh`。
 *
 * 上游装配前的 `evaluatePluginCompatibility` 优先认这个字段——**有它就忽略 peer 范围**，而 peer 的
 * `^X.Y.Z-pre` 在 SemVer 下只被同一 `major.minor.patch` 元组的候选接受，跨不得版本。范围取
 * `>= <当前版本> < <major>.<minor>.<patch+1>`：当前 patch 线连同它后续的 pre-release 都算兼容，再往上
 * 交回装配面拒绝（`includePrerelease` 下 `< 0.2.2` 也接受 `0.2.2-alpha.1`）。
 *
 * @param version - 构建环境里的 `DEEPSEEK_HARNESS_VERSION`。
 * @returns 版本范围；env 缺失或不认得该形态时 `undefined`（不写，清单原值留着）。
 */
function bundleDshRange(version: string | undefined): string | undefined {
  const value = version?.trim();
  if (value === undefined || value === "") return undefined;
  const matched = SEMANTIC_VERSION.exec(value);
  if (matched === null) return undefined;
  const [, major, minor, patch] = matched as unknown as [string, string, string, string];
  return `>= ${value} < ${major}.${minor}.${String(Number(patch) + 1)}`;
}

interface EntryArtifacts {
  runtime: string[];
  declarations: string[];
}

interface BuildRun {
  readonly entries: Map<string, EntryArtifacts>;
  outDir: string;
  // 清单只落一次：判定「齐了」之后的写入不能再被后来的回调重复触发。
  write?: Promise<void>;
}

// 同一个包的多格式构建分多轮进 `build:done`，产物要攒齐再落清单。
const runs = new Map<string, BuildRun>();

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// host 面取 ESM 产物——扩展名按产物实际落点，不猜。
function pick(files: readonly string[]): string | undefined {
  return files.find((file) => file.endsWith(".mjs") || file.endsWith(".js"));
}

// client 面取 **ESM 库**产物：`./client` 是给 `import` 消费的普通库（vite / node resolver）。CJS 工厂
// 不进 exports——它是 `__ModuleLoader__.load` 的注册脚本，**由 boot 按路径加载**（部署闭包照 `files`
// 拷 `dist`），不是给 `import` / `require` 用的模块；条件里给它 `require` / `default` 只会让按 `default`
// 兜底解析的消费方拿到带 `window.__ModuleLoader__` 外壳的工厂字节。
function pickLibrary(files: readonly string[]): string | undefined {
  return files.find((file) => file.endsWith(".mjs"));
}

// 出口键：`index` 是包根，其余按入口名。
function exportKey(entry: string): string {
  return entry === "index" ? "." : `./${entry}`;
}

// 每个要导出的入口都拿到自己那份产物了吗（host 面等 ESM、client 半等 CJS）——按「产物齐」判断，
// 多格式构建分多轮进 `build:done`，不必猜哪一轮是最后一轮。
function complete(run: BuildRun, options: PackageExportsOptions): boolean {
  const hidden = new Set(options.hidden ?? []);
  return Object.keys(options.entries).every((entry) => {
    if (hidden.has(entry)) return true;
    const files = run.entries.get(entry)?.runtime ?? [];
    // client 面等的是 **ESM 库**产物（`./client` 的出口就是它），host 面等 ESM。
    const runtime = entry === options.clientEntry ? pickLibrary(files) : pick(files);
    return runtime !== undefined;
  });
}

// 挂到 tsdown 的 `build:done`：从产物块推导每个入口的落点，产物攒齐后写回 `package.json`
// （入口约定与构建配置同一份事实）。
export function packageExportsHook(options: PackageExportsOptions): BuildDoneHook {
  return async (ctx) => {
    const cwd = process.cwd();
    const run: BuildRun = runs.get(cwd) ?? { entries: new Map(), outDir: "dist" };
    runs.set(cwd, run);
    run.outDir = relative(cwd, ctx.options.outDir).split(sep).join("/");

    for (const chunk of ctx.chunks) {
      if (chunk.type !== "chunk" || chunk.isEntry !== true || chunk.name === undefined) continue;
      // 声明产物块的名字是 `<入口名>.d`，运行时是 `<入口名>`。
      const declaration = chunk.name.endsWith(".d");
      const entry = declaration ? chunk.name.slice(0, -".d".length) : chunk.name;
      const found = run.entries.get(entry) ?? { runtime: [], declarations: [] };
      run.entries.set(entry, found);
      (declaration ? found.declarations : found.runtime).push(chunk.fileName);
    }
    if (options.declarationFiles !== undefined) {
      for (const [entry, found] of run.entries) {
        if (found.declarations.length === 0)
          found.declarations.push(...options.declarationFiles(entry));
      }
    }
    if (!complete(run, options) || run.write !== undefined) return;

    runs.delete(cwd);
    run.write = writeManifest(cwd, options, run);
    await run.write;
  };
}

/**
 * 直接写回某个包的清单（不跑 tsdown）：给**没有源码入口的数据包**用——`dsh.bundle` 的纯数据包只有
 * patch / locale / icon，没有可打包的入口，进不了 `build:done` 那条路。推导与钩子共用同一份
 * {@link writeManifest}，所以固定面与 `engines.dsh` 的口径不会两处漂移。
 *
 * @param cwd - 包目录。
 * @param options - 入口声明；数据包没有入口，缺省即空。
 */
export async function writePackageManifest(
  cwd: string,
  options: PackageExportsOptions = { entries: {} },
): Promise<void> {
  await writeManifest(cwd, options, { entries: new Map(), outDir: "dist" });
}

async function writeManifest(
  cwd: string,
  options: PackageExportsOptions,
  run: BuildRun,
): Promise<void> {
  const path = join(cwd, "package.json");
  const source = await readFile(path, "utf8");
  const manifest = JSON.parse(source) as Record<string, unknown>;
  const hidden = new Set(options.hidden ?? []);
  const { outDir } = run;
  // 清单里的产物路径一律带 `./` 前缀（`exports` 的写法约定）。
  const artifact = (file: string): string => `./${outDir}/${file}`;

  // `index` 是包根，先写它，其余 host 面按入口声明顺序跟上。
  const ordered = Object.entries(options.entries)
    .filter(([entry]) => !hidden.has(entry))
    .sort(([left], [right]) => (left === "index" ? -1 : right === "index" ? 1 : 0));

  const dev: Record<string, unknown> = {};
  const published: Record<string, unknown> = {};
  let clientDev: unknown;
  let clientPublished: unknown;

  for (const [entry, entrySource] of ordered) {
    const found = run.entries.get(entry);
    if (found === undefined) continue;

    if (entry === options.clientEntry) {
      // client 面出口：开发态指源码，发布态指 **ESM 库**产物 + 它的类型声明。CJS 工厂是模块表的注册
      // 脚本（按路径加载），不进出口——理由见 `pickLibrary`。写回内容也因此不取决于哪一轮先攒齐产物：
      // 两轮（cjs / esm）里只有 esm 那轮满足 {@link complete}，写出的都是这一种形态。
      const library = pickLibrary(found.runtime);
      if (library === undefined) continue;
      const declarations = found.declarations.find((file) => file.endsWith(".d.mts"));
      clientDev = entrySource;
      clientPublished =
        declarations === undefined
          ? { import: artifact(library), default: artifact(library) }
          : {
              types: artifact(declarations),
              import: artifact(library),
              default: artifact(library),
            };
      continue;
    }

    const runtime = pick(found.runtime);
    if (runtime === undefined) continue;
    // host 面也带 `types`：产物里本来就有 `.d.mts`，出口不写它，消费方的类型解析就落到 `any`。
    const declarations = found.declarations.find((file) => file.endsWith(".d.mts"));
    dev[exportKey(entry)] = entrySource;
    published[exportKey(entry)] =
      declarations === undefined
        ? artifact(runtime)
        : { types: artifact(declarations), default: artifact(runtime) };
  }

  dev[PACKAGE_JSON_EXPORT] = PACKAGE_JSON_EXPORT;
  // 不写 `./src/*`：那会让消费方（含预打包器）伸手进任意源码，破坏"按 export 预编译"的准确性。
  // 包内测试要内部符号时走**相对路径**（上游同一约定）。
  published[PACKAGE_JSON_EXPORT] = PACKAGE_JSON_EXPORT;
  if (await exists(join(cwd, "cordis.patch.yml"))) {
    dev[PATCH_EXPORT] = PATCH_EXPORT;
    published[PATCH_EXPORT] = PATCH_EXPORT;
  }
  if (clientDev !== undefined) {
    dev["./client"] = clientDev;
    published["./client"] = clientPublished;
  }
  if (await exists(join(cwd, "locale", "en.json"))) {
    dev[LOCALE_EXPORT] = LOCALE_EXPORT;
    published[LOCALE_EXPORT] = LOCALE_EXPORT;
  }

  const publishConfig: Record<string, unknown> = {
    ...(manifest["publishConfig"] as Record<string, unknown> | undefined),
  };
  if (options.bin !== undefined) {
    const bins: Record<string, string> = {};
    const publishedBins: Record<string, string> = {};
    for (const [name, entry] of Object.entries(options.bin)) {
      const entrySource = options.entries[entry];
      const runtime = pick(run.entries.get(entry)?.runtime ?? []);
      if (entrySource === undefined || runtime === undefined) continue;
      bins[name] = entrySource;
      publishedBins[name] = artifact(runtime);
    }
    manifest["bin"] = bins;
    publishConfig["bin"] = publishedBins;
  }
  const rootEntry = published["."];
  if (options.legacy === true && typeof rootEntry === "string") {
    manifest["main"] = rootEntry;
    manifest["module"] = rootEntry;
  }
  manifest["exports"] = dev;
  publishConfig["exports"] = published;
  manifest["publishConfig"] = publishConfig;

  // 装配面（`dsh.bundle`）才写 dsh 要求的版本范围：它是"装进 profile 的那一层"被预检的字段，
  // 与出口一样由构建推导（值见 `bundleDshRange`），不手写。
  const declared = manifest["dsh"] as { bundle?: unknown } | undefined;
  const isBundle = typeof declared?.bundle === "object" && declared.bundle !== null;
  const dshRange = isBundle ? bundleDshRange(process.env[HARNESS_VERSION_ENV]) : undefined;
  if (dshRange !== undefined) {
    const engines = manifest["engines"];
    manifest["engines"] = {
      ...(typeof engines === "object" && engines !== null ? engines : {}),
      dsh: dshRange,
    };
  }

  const next = `${JSON.stringify(manifest, null, 2)}\n`;
  if (next !== source) await writeFile(path, next);
}
