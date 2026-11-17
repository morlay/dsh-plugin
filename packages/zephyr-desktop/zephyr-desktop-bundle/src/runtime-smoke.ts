// 打包期冒烟：闭包复制进 `Resources/runtime` 之后，先证明它**自包含**，再让包出厂。
//
// 为什么要有它：deploy 出来的闭包曾经「看着像装好了、跑起来才 404」——某个上游包的链接整个缺失，
// 而 bundle 一路绿灯。三条判据前置：
//   ① `node_modules/@morlay/*` 的 symlink **允许**（pnpm 的顶层本来就是相对链指进闭包内的 `.pnpm`），
//      但 realpath 必须落在 `Resources/runtime` 内——**逃逸的链接**（绝对路径 / 指回源码 / 出闭包）才红；
//   ② 闭包清单里的依赖（加两项壳 / loader 必需）都能从闭包解析；
//   ③ 装配文件 `bootstrap.mjs` 能在闭包自己的 loader 下被加载（静态缺链在这一步暴露）。
// 失败一律 `CliError`；**不在这里补装或逐个实体化**——那只会把 deploy 的问题盖住。
import { spawn } from "node:child_process";
import { readFile, readdir, readlink, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { CliError } from "@morlay/zephyr-cli";

/** 壳与 loader 必须能从闭包解析的两项（少了装出来的应用起不来）。 */
export const REQUIRED_MODULES = ["@morlay/zephyr", "@morlay/dsh-oxc-node"] as const;

/** `node_modules/@morlay/*` 下的一个 symlink。 */
export interface ClosureLink {
  /** 条目名（`@morlay/<name>`）。 */
  readonly name: string;
  /** `readlink` 的原文（相对链就是相对路径）。 */
  readonly target: string;
  /** realpath 是否落在 `Resources/runtime` 内（相对 `.pnpm` 合法）。 */
  readonly inside: boolean;
}

/** 一次冒烟的发现（没有逃逸链接、没有缺包、入口能加载 = 通过）。 */
export interface RuntimeSmokeReport {
  /** `node_modules/@morlay/*` 下的全部 symlink（合法与逃逸都在这里，用 `inside` 区分）。 */
  readonly links: readonly ClosureLink[];
  /** 解析不到的依赖名。 */
  readonly missing: readonly string[];
  /** 入口加载失败的说明（`undefined` = 加载成功）。 */
  readonly loadFailure?: string | undefined;
}

/** 冒烟用到的两个外部动作（测试换替身）。 */
export interface RuntimeSmokeActions {
  /** 从闭包解析一个包名（默认走 `createRequire` + 清单存在性）。 */
  readonly resolve?: (runtimeDir: string, name: string) => Promise<string | undefined>;
  /** 加载入口（默认起子进程 + 闭包自己的 loader）；返回失败说明。 */
  readonly load?: (runtimeDir: string, entry: string) => Promise<string | undefined>;
}

/**
 * 跑三条判据，返回发现（**不抛**，好让调用方拼一条完整的错误）。
 * @param runtimeDir - `Resources/runtime`（复制后的真目录）。
 * @param actions - 解析与加载动作（测试可换替身）。
 * @returns 发现报告。
 */
export async function runtimeSmokeOf(
  runtimeDir: string,
  actions: RuntimeSmokeActions = {},
): Promise<RuntimeSmokeReport> {
  const resolve = actions.resolve ?? resolveFrom;
  const load = actions.load ?? loadEntry;
  const links = await scopeLinksOf(runtimeDir);
  const missing: string[] = [];
  for (const name of [
    ...REQUIRED_MODULES,
    ...(await dependencyNamesOf(join(runtimeDir, "package.json"))),
  ]) {
    if ((await resolve(runtimeDir, name)) === undefined) missing.push(name);
  }
  // 每个 `@morlay/*` 自己声明的依赖也要能从**它的真身**解析：懒加载的包（例如 storage-json 那种
  // 「只有用到时才 import」）不会在入口加载里暴露，但装出来一样是缺包。
  missing.push(...(await missingInScopedOf(runtimeDir)));
  const loadFailure = await load(runtimeDir, join(runtimeDir, "bootstrap.mjs"));
  return {
    links,
    missing: [...new Set(missing)],
    ...(loadFailure === undefined ? {} : { loadFailure }),
  };
}

/**
 * 三条判据有任一不成立就抛（装配链在打包这一步停下，而不是等到用户双击）。
 *
 * 链接分两类：realpath 在闭包内的是**合法**（pnpm 的正常形态），逃逸的才进错误。
 * @param runtimeDir - `Resources/runtime`。
 * @param actions - 解析与加载动作（测试可换替身）。
 * @returns 通过时的报告（打包日志用它记「几个链接、几个逃逸」）。
 * @throws CliError 有逃逸链接、缺包或入口加载失败。
 */
export async function assertRuntimeSmoke(
  runtimeDir: string,
  actions: RuntimeSmokeActions = {},
): Promise<RuntimeSmokeReport> {
  const report = await runtimeSmokeOf(runtimeDir, actions);
  const escaping = report.links.filter((link) => !link.inside);
  const problems: string[] = [];
  if (escaping.length > 0) {
    problems.push(
      `闭包里有逃逸链接（realpath 不在 ${runtimeDir} 内）：${escaping
        .map((link) => `${link.name} -> ${link.target}`)
        .join("、")}`,
    );
  }
  if (report.missing.length > 0) {
    problems.push(`从闭包解析不到：${report.missing.join("、")}`);
  }
  if (report.loadFailure !== undefined) {
    problems.push(`装配文件 bootstrap.mjs 加载失败：${report.loadFailure}`);
  }
  if (problems.length === 0) return report;
  throw new CliError(
    [`运行时闭包不自包含（${runtimeDir}）：`, ...problems.map((line) => `  · ${line}`)].join("\n"),
  );
}

/**
 * 打包产物里的 `Resources` 目录：mac 是 `<app>/Contents/Resources`，其它平台 `<app>/resources`。
 * @param appDir - 打包产出的应用目录。
 * @returns Resources 目录。
 * @throws CliError 两种布局都不存在。
 */
export async function resourcesDirOf(appDir: string): Promise<string> {
  const candidates = [join(appDir, "Contents", "Resources"), join(appDir, "resources")];
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isDirectory()) return candidate;
    } catch {
      // 试下一种布局。
    }
  }
  throw new CliError(`找不到打包产物里的 Resources 目录：试过 ${candidates.join("、")}。`);
}

/**
 * 打包产物里的宿主目录：`<Resources>/runtime`（真目录：壳要 `chdir` 进去）。
 * @param appDir - 打包产出的应用目录。
 * @returns 宿主目录。
 * @throws CliError 两种布局都找不到 `bootstrap.mjs`。
 */
export async function runtimeDirInAppOf(appDir: string): Promise<string> {
  const runtimeDir = join(await resourcesDirOf(appDir), "runtime");
  try {
    await readFile(join(runtimeDir, "bootstrap.mjs"));
    return runtimeDir;
  } catch {
    throw new CliError(`打包产物里的宿主目录缺 bootstrap.mjs：${runtimeDir}。`);
  }
}

/**
 * `node_modules/@morlay/*` 下的全部 symlink，并判断 realpath 是否仍在闭包内。
 *
 * 允许 symlink：pnpm 的顶层本来就是「相对链指进闭包内的 `.pnpm`」。判据是**落点**而不是形态——
 * 绝对路径、指回源码、或干脆指向闭包外（含悬空）都算逃逸。
 * @param runtimeDir - 闭包根。
 * @returns 条目（按名字排序）；没有 scope 目录就是空。
 */
async function scopeLinksOf(runtimeDir: string): Promise<readonly ClosureLink[]> {
  const scope = join(runtimeDir, "node_modules", "@morlay");
  const entries = await readdir(scope, { withFileTypes: true }).catch(() => []);
  const root = await realpath(runtimeDir).catch(() => runtimeDir);
  const links: ClosureLink[] = [];
  for (const entry of entries) {
    if (!entry.isSymbolicLink()) continue;
    const path = join(scope, entry.name);
    const target = await readlink(path).catch(() => "");
    const resolved = await realpath(path).catch(() => undefined);
    links.push({
      name: entry.name,
      target,
      inside: resolved !== undefined && (resolved === root || resolved.startsWith(`${root}${sep}`)),
    });
  }
  return links.sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * 一份清单里声明的依赖名。
 * @param manifestPath - `package.json` 的绝对路径。
 * @returns 依赖名（读不到清单就是空）。
 */
async function dependencyNamesOf(manifestPath: string): Promise<readonly string[]> {
  const raw = await readFile(manifestPath, "utf8").catch(() => undefined);
  if (raw === undefined) return [];
  try {
    const manifest = JSON.parse(raw) as { readonly dependencies?: Record<string, unknown> };
    return Object.keys(manifest.dependencies ?? {});
  } catch {
    return [];
  }
}

/**
 * `@morlay/*` 各包自己声明的依赖里解析不到的那些（从**真身**解析：CJS 的 `createRequire` 对
 * 符号链接路径按字面走，会误报 MODULE_NOT_FOUND——实测 `dsh-storage` 的 storage-json 就是这样）。
 * @param runtimeDir - 闭包根。
 * @returns `@morlay/<包> -> <缺的包>` 形式的条目。
 */
async function missingInScopedOf(runtimeDir: string): Promise<readonly string[]> {
  const scope = join(runtimeDir, "node_modules", "@morlay");
  const entries = await readdir(scope, { withFileTypes: true }).catch(() => []);
  const missing: string[] = [];
  for (const entry of entries) {
    // 悬空链接由链接判据报，这里只查「装了的包自己的依赖」。
    const real = await realpath(join(scope, entry.name, "package.json")).catch(() => undefined);
    if (real === undefined) continue;
    for (const name of await dependencyNamesOf(real)) {
      if ((await resolveFromManifest(real, name)) === undefined) {
        missing.push(`@morlay/${entry.name} -> ${name}`);
      }
    }
  }
  return missing;
}

/**
 * 从子进程的 stderr 里挑出最像原因的那一行（栈第一行通常是 node 内部路径，读的人看不出问题）。
 * @param stderr - 子进程的 stderr。
 * @returns 一行说明（挑不到就给尾部 500 字）。
 */
function firstErrorLineOf(stderr: string): string {
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const reason =
    lines.find((line) => /^Error\b/u.test(line)) ??
    lines.find((line) => /Cannot find|ERR_(MODULE|PACKAGE)_NOT_FOUND/u.test(line)) ??
    lines.at(-1) ??
    "";
  return reason.slice(-500);
}

/**
 * 从闭包里解析一个包：先按包名，再按它的 `package.json`。
 *
 * 为什么要退一步：只给子路径导出（没有 `.`）的包（例如 `@oxc-project/runtime`）按包名解析会报
 * `ERR_PACKAGE_PATH_NOT_EXPORTED`——那是**包装好了**，不是缺包。缺包时两种解析都失败。
 * @param runtimeDir - 闭包根。
 * @param name - 包名。
 * @returns 入口（或清单）路径，或 `undefined`（确实没有这个包）。
 */
function resolveFrom(runtimeDir: string, name: string): Promise<string | undefined> {
  return resolveFromManifest(join(runtimeDir, "package.json"), name);
}

/**
 * 从某份清单所在的位置解析一个包（先按包名，再按清单存在性）。
 * @param manifestPath - 基准 `package.json`（用它的**真身**：符号链接路径会误报）。
 * @param name - 包名。
 * @returns 入口（或清单）路径，或 `undefined`。
 */
async function resolveFromManifest(
  manifestPath: string,
  name: string,
): Promise<string | undefined> {
  const require = createRequire(manifestPath);
  try {
    return require.resolve(name);
  } catch {
    // 没有 "." 导出的包（例如 `@oxc-project/runtime`）走到这里：按「盘上有没有它」判。
  }
  for (const base of require.resolve.paths(name) ?? []) {
    const manifest = join(base, name, "package.json");
    try {
      await readFile(manifest);
      return manifest;
    } catch {
      // 这个解析根里没有，试下一个。
    }
  }
  return undefined;
}

/**
 * 在闭包自己的 loader 下加载装配文件（子进程：不把宿主拖进打包进程）。
 * @param runtimeDir - 宿主目录。
 * @param entry - `bootstrap.mjs` 的绝对路径。
 * @returns 失败说明，成功为 `undefined`。
 */
async function loadEntry(runtimeDir: string, entry: string): Promise<string | undefined> {
  const loader = await resolveFrom(runtimeDir, "@morlay/dsh-oxc-node");
  if (loader === undefined) return "闭包里没有 @morlay/dsh-oxc-node（loader）";
  const script = `await import(${JSON.stringify(pathToFileURL(entry).href)});`;
  const env: NodeJS.ProcessEnv = { ...process.env };
  // 父进程的 NODE_OPTIONS 可能又挂一份 loader（pnpm 注入）：这里只留闭包里的那一份。
  delete env.NODE_OPTIONS;
  delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((done) => {
    const child = spawn(
      process.execPath,
      ["--import", pathToFileURL(loader).href, "--eval", script],
      {
        cwd: runtimeDir,
        env,
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", (error: Error) => done(error.message));
    child.once("close", (code: number | null) => {
      done(code === 0 ? undefined : `子进程退出码 ${String(code)}：${firstErrorLineOf(stderr)}`);
    });
  });
}
