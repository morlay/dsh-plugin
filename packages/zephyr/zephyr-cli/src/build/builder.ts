// 构建：**三步**——静态面、运行时闭包、入口 bundle。
//
// 三步都是外部动作（vite / pnpm / rolldown）。它们不装配任何清单：构建的输入是「布局 + 解析规则」，
// 不是运行期行树——装一棵树只为拿一个构建器，会顺手把服务起起来、把库打开，代价与收益不成比例。
//
// 解析规则（alias / define / 装饰器）住框架层，由应用在 `client.vite` 指的配置文件里转手一次；
// CLI 只负责把 `outDir` 与入口喂给 vite。
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createRequire as createRequireOf } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { InjectionToken } from "@morlay/zephyr";
import type { ResolvedConfig } from "../config/contract.ts";
import { CliError } from "../errors.ts";
import type { ZephyrLayout } from "../layout.ts";
import { prebundleAll, type PrebundleTarget } from "@morlay/zephyr-app/federation/prebundle";
import { planPrebundle } from "@morlay/zephyr-app/federation/prebundle-plan";
import { resolveDataDir } from "../data-dir.ts";

const execFileAsync = promisify(execFile);

/** 一次构建的输入。 */
export interface BuildInput {
  /** 解析后的工作区配置。 */
  readonly resolved: ResolvedConfig;
  /** 产物布局。 */
  readonly layout: ZephyrLayout;
  /** `--no-prebundle`：跳过第四步（快速迭代用；preview 会因此报错）。 */
  readonly prebundle?: boolean;
}

/** 一步的结果。 */
export interface BuildStep {
  /** 步骤名（汇总表里的一行）。 */
  readonly name: string;
  /** 用时（毫秒）。 */
  readonly ms: number;
  /** 一行细节（产出的位置或条数）。 */
  readonly detail?: string;
}

/** 一次构建的结果。 */
export interface BuildSummary {
  readonly steps: readonly BuildStep[];
  readonly dist: string;
  readonly runtime: string;
  readonly entry: string;
}

/** 三步的集合：命令只负责编排与汇总，动作在这里（单测替换成替身即可判编排）。 */
export interface BuildSteps {
  readonly client: (input: BuildInput) => Promise<void>;
  readonly runtime: (input: BuildInput) => Promise<void>;
  readonly entry: (input: BuildInput) => Promise<void>;
  /** 第四步：前端预编译（把静态面里出现的联邦产物一次打出来）。 */
  readonly prebundle: (input: BuildInput) => Promise<void>;
}

/** 三步的值令牌。 */
export const BuildSteps = InjectionToken<BuildSteps>("build-steps");

/** 默认的三步。 */
export function defaultBuildSteps(): BuildSteps {
  return {
    client: buildClient,
    runtime: buildRuntime,
    entry: bundleEntry,
    prebundle: buildPrebundle,
  };
}

/**
 * 按顺序跑三步并汇总。
 * @param input - 工作区配置与布局。
 * @param steps - 三步的实现（缺省是真实动作）。
 * @returns 每步的耗时与产出位置。
 */
export async function runBuild(
  input: BuildInput,
  steps: BuildSteps = defaultBuildSteps(),
): Promise<BuildSummary> {
  const collected: BuildStep[] = [];
  await rm(input.layout.root, { recursive: true, force: true });
  await mkdir(input.layout.dist, { recursive: true });
  await mkdir(input.layout.cache, { recursive: true });

  for (const [name, action] of [
    ["静态面", steps.client],
    ["运行时闭包", steps.runtime],
    ["入口 bundle", steps.entry],
    ...(input.prebundle === false ? [] : ([["前端预编译", steps.prebundle]] as const)),
  ] as const) {
    const startedAt = Date.now();
    await action(input);
    collected.push({ name, ms: Date.now() - startedAt, detail: detailOf(name, input) });
  }
  // 三步都完成才冒烟：入口 bundle 是第三步的产物，前两步跑完时它还不存在。
  await smokeClosure(input.layout);
  return {
    steps: collected,
    dist: input.layout.dist,
    runtime: input.layout.runtime,
    entry: input.layout.entry,
  };
}

/**
 * 汇总里那一行细节：每步产出的位置。
 * @param name - 步骤名。
 * @param input - 布局。
 * @returns 位置。
 */
function detailOf(name: string, input: BuildInput): string {
  if (name === "静态面") return input.layout.dist;
  if (name === "运行时闭包") return input.layout.runtime;
  return input.layout.entry;
}

/**
 * 静态面：`vite build`。
 *
 * 给了 `client.vite` 就用应用侧那份配置文件——解析规则（alias / define / 装饰器）住框架层，
 * 由应用转手，CLI 不复制它们。`outDir` 与入口仍由 CLI 给：那是「产物落在哪」的约定。
 * @param input - 工作区配置与布局。
 */
export async function buildClient(input: BuildInput): Promise<void> {
  const vite = (await import("vite")) as { build: (config: unknown) => Promise<unknown> };
  const inline = (input.resolved.config.client.vite ?? {}) as {
    readonly build?: { readonly rollupOptions?: Record<string, unknown> };
  };
  await vite.build({
    // 不读项目里的 `vite.config.*`：配置只有一份（`zephyr.config.ts` 的 `client.vite`）。
    configFile: false,
    ...inline,
    root: dirname(input.resolved.clientEntry),
    cacheDir: input.layout.cache,
    logLevel: "warn",
    plugins: input.resolved.config.client.plugins ?? [],
    build: {
      ...inline.build,
      outDir: input.layout.dist,
      emptyOutDir: true,
      // 入口就是页面：vite 在这条路上产出 index.html 并把模块脚本注入进去。
      rollupOptions: {
        ...inline.build?.rollupOptions,
        input: input.resolved.clientEntry,
      },
    },
  });
}

/**
 * 运行时闭包：`pnpm deploy --prod` 到 `runtime/`。
 *
 * `strictDepBuilds=false`：deploy 会在目标目录重装一次，工作区里批准的构建脚本不会自动跟过去；
 * 不放开这一条，闭包会停在 `ERR_PNPM_IGNORED_BUILDS` 上。
 * @param input - 工作区配置与布局。
 */
export async function buildRuntime(input: BuildInput): Promise<void> {
  const manifest = JSON.parse(
    await readFile(join(input.resolved.workspace, "package.json"), "utf8"),
  ) as { name?: string };
  const name = manifest.name ?? basename(input.resolved.workspace);
  // `pnpm deploy` 要求目标目录**不存在或为空**（否则 `ERR_PNPM_DEPLOY_DIR_NOT_EMPTY`）：
  // 上一次构建留下的闭包必须先清掉，连续构建才是幂等的。
  await resetRuntime(input.layout);
  try {
    await execFileAsync(
      "pnpm",
      [
        "--filter",
        name,
        // workspace 依赖按**内容**装进闭包（不留一条指回源码的 `file:` 链接）：命令行覆盖
        // `pnpm-workspace.yaml` 的 `linkWorkspacePackages: true`，配置文件一行不动。
        "--config.inject-workspace-packages=true",
        "deploy",
        "--prod",
        // deploy 会在目标目录重装一次，工作区里批准的构建脚本不会自动跟过去。
        "--config.strictDepBuilds=false",
        input.layout.runtime,
      ],
      { cwd: input.resolved.workspace },
    );
  } catch (error) {
    throw new CliError(
      `运行时闭包失败（pnpm --filter ${name} deploy --prod）：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * 闭包冒烟：**把闭包复制到仓库外**再用 loader 加载 `entry.mjs`。
 *
 * 必须在仓外：在仓库内加载时，Node 会顺着目录往上找到工作区自己的 `node_modules`，
 * 把"闭包里缺这个包"变成"仓库里有"——这正是 bundle 之后才炸的那类静默失败。
 * 闭包不存在就跳过：装配级用例（`runBuild` 配假 steps）与 `--ignore-scripts` 之类的空跑都没有真闭包，
 * 那一步冒烟没有意义——「没东西可冒烟」不等于「冒烟失败」。
 * @param layout - 产物布局。
 * @returns `skipped`（没有闭包或没有入口）或 `ok`（真加载过）。
 */
export async function smokeClosure(layout: ZephyrLayout): Promise<"skipped" | "ok"> {
  const present = await Promise.all(
    [layout.runtime, layout.entry].map((path) =>
      stat(path).then(
        () => true,
        () => false,
      ),
    ),
  );
  if (present.includes(false)) return "skipped";
  const sandbox = await mkdtemp(join(tmpdir(), "zephyr-closure-"));
  try {
    await cp(layout.runtime, sandbox, { recursive: true, verbatimSymlinks: true });
    const loader = createRequireOf(import.meta.url).resolve("@morlay/dsh-oxc-node");
    const entry = pathToFileURL(join(sandbox, "entry.mjs")).href;
    await execFileAsync(
      process.execPath,
      ["--import", loader, "--input-type=module", "-e", `await import(${JSON.stringify(entry)})`],
      {
        cwd: sandbox,
        // 摘掉工作区的 `nodeOptions`（`--import @oxc-node/core/register`）：那份 loader 只装在仓库里，
        // 闭包里没有它；闭包的 loader 由上面的 `--import` 显式给。
        env: { ...process.env, NODE_OPTIONS: "" },
        timeout: 180_000,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    return "ok";
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CliError(
      `运行时闭包不自包含（${layout.runtime} 复制到仓库外就加载不起来）：\n` +
        `${detail.split("\n").slice(0, 8).join("\n")}\n` +
        "多半是某个包 import 了没声明成 dependencies 的包（devDependencies 会被 --prod 剔掉）。",
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
}

/**
 * 清空运行时闭包目录（deploy 只接受空目录）。
 * @param layout - 产物布局。
 */
export async function resetRuntime(layout: ZephyrLayout): Promise<void> {
  await rm(layout.runtime, { recursive: true, force: true });
}

/**
 * 入口：把 `server.entry` 打成单文件，preview 与桌面壳都跑它。
 * @param input - 工作区配置与布局。
 */
/**
 * 第四步：前端预编译。
 *
 * 目标清单来自**应用 client 入口的静态 import 图**（`planPrebundle`）+ `clientModules.include`
 * 过滤：不从 `dist` 反推——build 的静态面走 vite/rollup 常规打包，产物里没有联邦地址（反推永远为空）。
 * @param input - 工作区配置与布局。
 */
export async function buildPrebundle(input: BuildInput): Promise<void> {
  const appManifest = join(input.resolved.workspace, "package.json");
  const appRequire = createRequireOf(appManifest);
  const clientEntry = join(input.resolved.workspace, "src", "client", "app-boot.ts");
  const plan = await planPrebundle({ entry: clientEntry, appManifest });
  const REQUIRED = ["@morlay/zephyr-app", "@morlay/dsh-conversation", "shiki"];
  if (plan.targets.length === 0) {
    throw new CliError(`前端预编译清单为空：从 ${clientEntry} 的静态 import 图里没枚举到任何目标`);
  }
  const missing = REQUIRED.filter(
    (name) => !plan.targets.some((target: PrebundleTarget) => target.name === name),
  );
  if (missing.length > 0) {
    throw new CliError(`前端预编译清单缺已知包：${missing.join(", ")}`);
  }
  const dataDir = resolveDataDir({
    spec: input.resolved.config.dataDir ?? "workspace",
    profileDir: input.resolved.workspace,
    appName: input.resolved.appName,
  });
  const cacheRoot = cacheRootOf(dataDir);
  const nodeStub = join(
    dirname(appRequire.resolve("@morlay/zephyr-app/package.json")),
    "src",
    "node-stub",
    "node-stub.cjs",
  );
  const targets: PrebundleTarget[] = [...plan.targets];
  const result = await prebundleAll({
    targets,
    cacheRoot,
    repoRoot: input.resolved.workspace,
    nodeStub,
    appManifest,
  });
  if (result.failures.length > 0) {
    const detail = result.failures
      .slice(0, 8)
      .map(
        (failure) =>
          `${failure.target.name}@${failure.target.version}/${failure.target.exportName}: ${failure.reason}`,
      )
      .join("\n  ");
    throw new CliError(`前端预编译失败（${String(result.failures.length)} 条）：\n  ${detail}`);
  }
}

/**
 * 前端预编译的缓存根（与 `AppEnv.cacheDirOf("client-modules")` 同口径）。
 * @param dataDir - 数据根。
 * @returns 缓存根。
 */
export function cacheRootOf(dataDir: string): string {
  return join(dataDir, "cache", "client-modules");
}

export async function bundleEntry(input: BuildInput): Promise<void> {
  const rolldown = (await import("rolldown")) as {
    build: (options: unknown) => Promise<unknown>;
  };
  await rolldown.build({
    input: input.resolved.serverEntry,
    output: { file: input.layout.entry, format: "esm" },
    // 第三方留在闭包里，只有工作区自己的源码进 bundle。
    external: (id: string) => !id.startsWith(".") && !id.startsWith("/"),
  });
}
