// 包清单（`exports` / `publishConfig.exports`）由构建生成，不再手写：手写的两份清单要么漏键、
// 要么与产物脱节，`@morlay/dsh-desktop-host` 的 `./package.json` 出口就因此丢过（见
// `.agents/standards/how-to-write.md` 的「包出口」一节）。
//
// 两条规则就够：
// - **host 面**：一个入口一个出口，顶层出口指源码（workspace 内直连 `src`），发布态指产物；
// - **client 半**：它只能是 CJS 单文件 bundle（模块系统的工厂契约），出口固定写成
//   `{ types, default }`——顶层 `types` 回源、发布态取 `.d.cts` 与 `.cjs`，**不参与 ESM / CJS 的格式推导**
//   （让推导去猜，它会把 `client.cjs` 当成 `.` 的 require 变体，清单就错了）。
import { readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { TsdownHooks } from "tsdown";

/** tsdown `build:done` 钩子；上下文与产物块类型都从 tsdown 自己的定义取，不手抄一份。 */
type BuildDoneHook = TsdownHooks["build:done"];

export interface PackageExportsOptions {
  /** 入口名 → 源码路径（`index` 是包根出口 `.`）。 */
  readonly entries: Record<string, string>;
  /** client 半的入口名；有它时该出口按 CJS 单文件写。 */
  readonly clientEntry?: string;
  /** 只构建、不导出的入口名（产物要落位，但不该成为包的门面）。 */
  readonly hidden?: readonly string[];
  /** 命令名 → 入口名：`bin` 两侧一起写（顶层指源码、发布态指产物）。 */
  readonly bin?: Record<string, string>;
  /**
   * 额外写 Node / Electron 的传统入口 `main` / `module`（都指包根出口的产物）。
   *
   * 这类消费方不看 `exports`：Electron 以**包目录**为 app 启动时按 `main` 找主进程入口
   * （`dsh-desktopify dev` 就是这么起壳的），缺了它 Electron 会退回 `index.js` 并报
   * 「Unable to find Electron app … Cannot find module <包目录>」。
   */
  readonly legacy?: boolean;
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
  /** 清单只落一次：判定「齐了」之后的写入不能再被后来的回调重复触发。 */
  write?: Promise<void>;
}

/** 同一个包的多格式构建分多轮进 `build:done`，产物要攒齐再落清单。 */
const runs = new Map<string, BuildRun>();

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** client 半取 CJS 产物，host 面取 ESM 产物——扩展名按产物实际落点，不猜。 */
function pick(files: readonly string[], cjs: boolean): string | undefined {
  return files.find((file) =>
    cjs ? file.endsWith(".cjs") : file.endsWith(".mjs") || file.endsWith(".js"),
  );
}

/** 出口键：`index` 是包根，其余按入口名。 */
function exportKey(entry: string): string {
  return entry === "index" ? "." : `./${entry}`;
}

/**
 * 每个要导出的入口都拿到自己那一份产物了吗？——host 面等 ESM 产物，client 半等 CJS 产物。
 * 多格式构建分多轮进 `build:done`，用「产物齐」而不是「轮次齐」判断，才不必猜哪一轮是最后一轮。
 */
function complete(run: BuildRun, options: PackageExportsOptions): boolean {
  const hidden = new Set(options.hidden ?? []);
  return Object.keys(options.entries).every((entry) => {
    if (hidden.has(entry)) return true;
    const runtime = pick(run.entries.get(entry)?.runtime ?? [], entry === options.clientEntry);
    return runtime !== undefined;
  });
}

/**
 * 挂到 tsdown 的 `build:done`：从产物块推导每个入口的落点，产物攒齐后写回 `package.json`。
 * @param options - 入口约定，与构建配置同一份事实。
 */
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
  /** 清单里的产物路径一律带 `./` 前缀（`exports` 的写法约定）。 */
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
      // client 半只有 CJS 单文件这一种形态，按约定直接写，不做格式推导。
      const runtime = pick(found.runtime, true);
      if (runtime === undefined) continue;
      const declarations = found.declarations.find((file) => file.endsWith(".d.cts"));
      clientDev = { types: entrySource, default: artifact(runtime) };
      clientPublished =
        declarations === undefined
          ? { default: artifact(runtime) }
          : { types: artifact(declarations), default: artifact(runtime) };
      continue;
    }

    const runtime = pick(found.runtime, false);
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
      const runtime = pick(run.entries.get(entry)?.runtime ?? [], false);
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
