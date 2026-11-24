// 包清单（`exports` / `publishConfig.exports`）由构建从产物推导并写回 `package.json`，不手写：
// 顶层出口指源码（workspace 内直连 `src`），发布态指产物；client 半发布态只出一份 **CJS 工厂**——
// 那是 `__ModuleLoader__.load` 的注册脚本，挂在该出口的 `default` 条件上（见 `pickFactory`）。
// 分档：`private: true` 只写 `exports`（源码直连），不写 `publishConfig` / `engines.dsh`；发布包另写
// 发布态清单与 `engines.dsh`。`./client` 与 `./cordis.patch.yml` 只进发布态。
//
// **bundle 包（dsh 行入口）单独一档**：顶层 `exports` 是**空对象**（源码不被当库消费），发布态只写
// `.` → `{ default: ./dist/index.mjs }`（没有 `types`：bundle 包不出 `.d.mts`）、`./package.json`、
// `./cordis.patch.yml`，以及有浏览器半时的 `./client` → `{ default: ./dist/client.cjs }`。
// 出口约定与理由见 `.agents/standards/how-to-write.md` 的「包出口」一节。
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** 一条 bundle 行声明：改现有行（id / disabled / config），或插入新行（insert）。 */
export type BundleRow =
  | {
      readonly id: string;
      readonly disabled?: boolean;
      readonly config?: Readonly<Record<string, unknown>>;
    }
  | {
      readonly insert: readonly {
        readonly id: string;
        readonly name: string;
        readonly config?: Readonly<Record<string, unknown>>;
      }[];
    };

export interface PackageExportsOptions {
  // 入口名 → 源码路径（`index` 是包根出口 `.`）。
  readonly entries: Record<string, string>;
  // client 半的入口名；有它时该出口按 **CJS 工厂**写（见 `pickFactory`）。
  readonly clientEntry?: string;
  // 只构建、不导出的入口名（产物要落位，但不该成为包的门面）。
  readonly hidden?: readonly string[];

  // bundle 的行声明：非 private 时生成 `cordis.patch.yml` 并写 `dsh.bundle.patch`。
  readonly bundle?: { readonly rows: readonly BundleRow[] };
  // 命令名 → 入口名：`bin` 两侧一起写（顶层指源码、发布态指产物）。
  readonly bin?: Record<string, string>;
  // 额外写 Node / Electron 的传统入口 `main` / `module`（都指包根出口的产物）：这类消费方不看
  // `exports`——Electron 以包目录为 app 启动时按 `main` 找主进程入口，缺了它退回 `index.js` 并报错。
  readonly legacy?: boolean;
  // 声明文件名的来源。声明由 `buildPackage` 在构建里产出（`<入口>.d.mts`），所以由调用方按同一套命名规则给出；
  // 缺省时发布态出口不带 `types`。
  readonly declarationFiles?: (entry: string) => readonly string[];
}

const PACKAGE_JSON_EXPORT = "./package.json";
const PATCH_EXPORT = "./cordis.patch.yml";
const LOCALE_EXPORT = "./locale/*.json";

// 有产物形态的源码出口：其余（样式、资产、通配资源）不打包，两种清单里都按源码路径写。
const MODULE_SOURCE = /\.(?:[cm]?[jt]sx?)$/u;

// 构建环境里的上游版本常量（`mise.toml` 的 `DEEPSEEK_HARNESS_VERSION`）：插件包的 dsh 要求由它推导。
const HARNESS_VERSION_ENV = "DEEPSEEK_HARNESS_VERSION";

// `X.Y.Z` 加可选 pre-release / build 后缀；其余形态（含 `workspace:`）不认。
const SEMANTIC_VERSION = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u;

/**
 * 插件包要写的 `engines.dsh`（只对发布包写）。
 *
 * 上游装配前的 `evaluatePluginCompatibility` 优先认这个字段——**有它就忽略 peer 范围**。范围取
 * `>= <当前版本> < <major>.<minor>.<patch+1>`：当前 patch 线连同它后续的 pre-release 都算兼容。
 *
 * @param version - 构建环境里的 `DEEPSEEK_HARNESS_VERSION`。
 * @returns 版本范围；env 缺失或不认得该形态时 `undefined`（不写，清单原值留着）。
 */
function dshEngineRange(version: string | undefined): string | undefined {
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
}

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

// client 面另取 **CJS 工厂**产物，挂在 `./client` 的 `default` 上：那是 `__ModuleLoader__.load` 的
// 注册脚本，按包名 + `./client` 解析并读字节的加载方走的就是这条**兜底**条件。
function pickFactory(files: readonly string[]): string | undefined {
  return files.find((file) => file.endsWith(".cjs"));
}

// 出口键：`index` 是包根，其余按入口名。
function exportKey(entry: string): string {
  return entry === "index" ? "." : `./${entry}`;
}

/**
 * 直接写回某个包的清单（不跑构建）：给**没有源码入口的数据包**用——`dsh.bundle` 的纯数据包只有
 * patch / locale / icon，没有可打包的入口。推导与构建共用同一份 {@link writeManifest}，所以固定面与
 * `engines.dsh` 的口径不会两处漂移。
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

// bundle 行清单 → `cordis.patch.yml`：首行固定「由 … 生成」，行内只写声明的键。
function renderPatch(name: string, rows: readonly BundleRow[]): string {
  const body = rows.map((row) => {
    if ("insert" in row) {
      const lines = ["- insert:"];
      for (const item of row.insert) {
        lines.push(`    - id: ${item.id}`, `      name: ${JSON.stringify(item.name)}`);
        if (item.config !== undefined) lines.push(`      config: ${JSON.stringify(item.config)}`);
      }
      return lines.join("\n");
    }
    const lines = [`- id: ${row.id}`];
    if (row.disabled !== undefined) lines.push(`  disabled: ${String(row.disabled)}`);
    if (row.config !== undefined) lines.push(`  config: ${JSON.stringify(row.config)}`);
    return lines.join("\n");
  });
  return `# 本文件由 ${name} 的 devkit build 生成，请勿手工编辑\n${body.join("\n")}\n`;
}

async function writeManifest(
  cwd: string,
  options: PackageExportsOptions,
  run: BuildRun,
): Promise<void> {
  const path = join(cwd, "package.json");
  const source = await readFile(path, "utf8");
  const manifest = JSON.parse(source) as Record<string, unknown>;
  const isPrivate = manifest["private"] === true;
  const name = typeof manifest["name"] === "string" ? manifest["name"] : "package";
  const hidden = new Set(options.hidden ?? []);
  // bundle 包（dsh 行入口）：顶层 `exports` 保持空，发布态出口按固定形状写。
  const bundleShape = options.bundle !== undefined;
  const { outDir } = run;
  // 清单里的产物路径一律带 `./` 前缀（`exports` 的写法约定）。
  const artifact = (file: string): string => `./${outDir}/${file}`;

  // `index` 是包根，先写它，其余 host 面按入口声明顺序跟上。
  const ordered = Object.entries(options.entries)
    .filter(([entry]) => !hidden.has(entry))
    .sort(([left], [right]) => (left === "index" ? -1 : right === "index" ? 1 : 0));

  // 顶层 `exports` 以现有清单为底（保留手写面，如 `./dsh-bundle`），按入口更新；
  // 只发布态入口不改顶层值，发布态另写 `publishConfig`。
  const previous = manifest["exports"];
  const dev: Record<string, unknown> =
    typeof previous === "object" && previous !== null
      ? { ...(previous as Record<string, unknown>) }
      : {};
  // 只发布态面不进顶层：client 是 dsh 读字节的那份，patch 是发布产物。
  delete dev["./client"];
  delete dev[PATCH_EXPORT];
  const published: Record<string, unknown> = {};
  let clientDev: unknown;
  let clientPublished: unknown;

  for (const [entry, entrySource] of ordered) {
    const found = run.entries.get(entry);
    if (found === undefined) continue;

    if (entry === options.clientEntry) {
      // client 面出口：开发态指源码，发布态指**两份产物 + 类型声明**。
      // client 半只出 CJS 工厂（dsh 读字节的那份）；ESM 库不再产出。
      const factory = pickFactory(found.runtime);
      if (factory === undefined) continue;
      const declarations = found.declarations.find((file) => file.endsWith(".d.mts"));
      clientDev = entrySource;
      clientPublished =
        declarations === undefined
          ? { default: artifact(factory) }
          : { types: artifact(declarations), default: artifact(factory) };
      continue;
    }

    const runtime = pick(found.runtime);
    if (runtime === undefined) continue;
    // host 面也带 `types`：产物里本来就有 `.d.mts`，出口不写它，消费方的类型解析就落到 `any`。
    const declarations = found.declarations.find((file) => file.endsWith(".d.mts"));
    if (bundleShape) {
      // bundle 包的包根只出 `default`：行入口没有类型消费面（不出 `.d.mts`），顶层 `exports` 也不列。
      published[exportKey(entry)] = { default: artifact(runtime) };
      continue;
    }
    dev[exportKey(entry)] = entrySource;
    published[exportKey(entry)] =
      declarations === undefined
        ? artifact(runtime)
        : { types: artifact(declarations), default: artifact(runtime) };
  }

  // 没有产物形态的面（样式、资产、通配的资源出口）不打包，但发布态也得有一个键：原样带着 `src` 的
  // 路径发出去（`files` 里有 `src`）。只看「源码不是模块」的那一类，漏产物是构建的事，不能在这里被
  // 抄成源码路径糊过去。
  for (const [key, value] of Object.entries(dev)) {
    if (Object.hasOwn(published, key)) continue;
    if (typeof value !== "string" || MODULE_SOURCE.test(value)) continue;
    published[key] = value;
  }

  if (!bundleShape) dev[PACKAGE_JSON_EXPORT] = PACKAGE_JSON_EXPORT;
  published[PACKAGE_JSON_EXPORT] = PACKAGE_JSON_EXPORT;
  if (clientDev !== undefined) {
    // client 只进发布态清单（顶层 exports 仍是纯源码面）。
    published["./client"] = clientPublished;
    // client 半是 dsh 的浏览器插件：清单声明平台；external 由业务按需补。
    const current =
      typeof manifest["dsh"] === "object" && manifest["dsh"] !== null
        ? (manifest["dsh"] as Record<string, unknown>)
        : {};
    // 手写的 `inject` 等字段保留，只补平台。
    const currentClient =
      typeof current["client"] === "object" && current["client"] !== null
        ? (current["client"] as Record<string, unknown>)
        : {};
    manifest["dsh"] = { ...current, client: { ...currentClient, platform: "web" } };
  }

  // bundle 的行声明先落 patch，再按文件存在性补出口（数据包手写 patch 的路径也走这里）。
  if (options.bundle !== undefined && !isPrivate) {
    // patch 是发布态产物：落 dist，顶层 exports 不列。
    await mkdir(join(cwd, "dist"), { recursive: true });
    await writeFile(join(cwd, "dist", "cordis.patch.yml"), renderPatch(name, options.bundle.rows));
    published[PATCH_EXPORT] = "./dist/cordis.patch.yml";
  } else if (await exists(join(cwd, "cordis.patch.yml"))) {
    // 没有源码入口的数据包：patch 仍在包根，只进发布态。
    if (!isPrivate) published[PATCH_EXPORT] = PATCH_EXPORT;
  }
  if (await exists(join(cwd, "locale", "en.json"))) {
    if (!bundleShape) dev[LOCALE_EXPORT] = LOCALE_EXPORT;
    if (!isPrivate) published[LOCALE_EXPORT] = LOCALE_EXPORT;
  }

  if (options.bundle !== undefined && !isPrivate) {
    const current =
      typeof manifest["dsh"] === "object" && manifest["dsh"] !== null
        ? (manifest["dsh"] as Record<string, unknown>)
        : {};
    manifest["dsh"] = { ...current, bundle: { patch: "./dist/cordis.patch.yml" } };
  }

  if (options.bin !== undefined) {
    const bins: Record<string, string> = {};
    const publishedBins: Record<string, string> = {};
    for (const [binName, entry] of Object.entries(options.bin)) {
      const entrySource = options.entries[entry];
      const runtime = pick(run.entries.get(entry)?.runtime ?? []);
      if (entrySource === undefined || runtime === undefined) continue;
      bins[binName] = entrySource;
      publishedBins[binName] = artifact(runtime);
    }
    manifest["bin"] = bins;
    if (!isPrivate) {
      const publishConfig = {
        ...(manifest["publishConfig"] as Record<string, unknown> | undefined),
      };
      publishConfig["bin"] = publishedBins;
      manifest["publishConfig"] = publishConfig;
    }
  }
  const rootEntry = published["."];
  if (options.legacy === true && typeof rootEntry === "string") {
    manifest["main"] = rootEntry;
    manifest["module"] = rootEntry;
  }
  manifest["exports"] = bundleShape ? {} : dev;

  if (isPrivate) {
    // 私有包的发布态字段是死字段：不写 `publishConfig`，也不写 `engines.dsh`。
    delete manifest["publishConfig"];
    const engines = manifest["engines"];
    if (typeof engines === "object" && engines !== null) {
      const rest = { ...(engines as Record<string, unknown>) };
      delete rest["dsh"];
      if (Object.keys(rest).length > 0) manifest["engines"] = rest;
      else delete manifest["engines"];
    }
  } else {
    const publishConfig = { ...(manifest["publishConfig"] as Record<string, unknown> | undefined) };
    publishConfig["exports"] = published;
    manifest["publishConfig"] = publishConfig;
    const dshRange = dshEngineRange(process.env[HARNESS_VERSION_ENV]);
    if (dshRange !== undefined) {
      const engines = manifest["engines"];
      manifest["engines"] = {
        ...(typeof engines === "object" && engines !== null ? engines : {}),
        dsh: dshRange,
      };
    }
  }

  const next = `${JSON.stringify(manifest, null, 2)}\n`;
  if (next !== source) await writeFile(path, next);
}

/** 构建结果直接写回清单。 */
export function writeBuildManifest(
  cwd: string,
  options: {
    readonly entries: Record<string, string>;
    readonly artifacts: Readonly<Record<string, readonly string[]>>;
    readonly clientEntry?: string;
    readonly declarationFiles?: (entry: string) => readonly string[];
    readonly hidden?: readonly string[];
    readonly bin?: Record<string, string>;
    readonly bundle?: { readonly rows: readonly BundleRow[] };
  },
): Promise<void> {
  const entries = new Map<string, EntryArtifacts>();
  for (const [name, files] of Object.entries(options.artifacts)) {
    entries.set(name, {
      runtime: [...files],
      declarations: [...(options.declarationFiles?.(name) ?? [])],
    });
  }
  return writeManifest(
    cwd,
    {
      entries: options.entries,
      ...(options.clientEntry === undefined ? {} : { clientEntry: options.clientEntry }),
      ...(options.declarationFiles === undefined
        ? {}
        : { declarationFiles: options.declarationFiles }),

      ...(options.hidden === undefined ? {} : { hidden: options.hidden }),
      ...(options.bin === undefined ? {} : { bin: options.bin }),
      ...(options.bundle === undefined ? {} : { bundle: options.bundle }),
    },
    { entries, outDir: "dist" },
  );
}
