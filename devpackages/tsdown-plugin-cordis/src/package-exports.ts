// 包清单（`exports` / `publishConfig.exports`）由构建从产物推导并写回 `package.json`，不手写：
// 顶层出口指源码（workspace 内直连 `src`），发布态指产物；client 半发布态是 CJS 单文件 bundle。
// 出口约定与理由见 `.agents/standards/how-to-write.md` 的「包出口」一节。
import { readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { TsdownHooks } from "tsdown";

// tsdown `build:done` 钩子；上下文与产物块类型都从 tsdown 自己的定义取，不手抄一份。
type BuildDoneHook = TsdownHooks["build:done"];

export interface PackageExportsOptions {
  // 入口名 → 源码路径（`index` 是包根出口 `.`）。
  readonly entries: Record<string, string>;
  // client 半的入口名；有它时该出口按 CJS 单文件写。
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

// client 面取 **ESM 库**产物：`./client` 是"普通库"的出口，给 vite / node resolver 消费。
// CJS（模块表的工厂形态）不进 exports —— 它是 `__ModuleLoader__.load` 的注册脚本，由 boot 按路径加载，
// 不是给 `import`/`require` 用的模块。
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
      // client 面出口：开发态指源码，发布态指 **ESM 库**产物 + 它的类型声明。
      const library = pickLibrary(found.runtime);
      if (library === undefined) continue;
      const declarations = found.declarations.find((file) => file.endsWith(".d.mts"));
      clientDev = entrySource;
      clientPublished =
        declarations === undefined
          ? { import: artifact(library), default: artifact(library) }
          : { types: artifact(declarations), import: artifact(library), default: artifact(library) };
      continue;
    }

    const runtime = pick(found.runtime);
    if (runtime === undefined) continue;
    dev[exportKey(entry)] = entrySource;
    published[exportKey(entry)] = artifact(runtime);
  }

  dev[PACKAGE_JSON_EXPORT] = PACKAGE_JSON_EXPORT;
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

  const next = `${JSON.stringify(manifest, null, 2)}\n`;
  if (next !== source) await writeFile(path, next);
}
