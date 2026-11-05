// 构建：**三步**——静态面、运行时闭包、入口 bundle。
//
// 三步都是外部动作（vite / pnpm / rolldown）。它们不装配任何清单：构建的输入是「布局 + 解析规则」，
// 不是运行期行树——装一棵树只为拿一个构建器，会顺手把服务起起来、把库打开，代价与收益不成比例。
//
// 解析规则（alias / define / 装饰器）住框架层，由应用在 `client.vite` 指的配置文件里转手一次；
// CLI 只负责把 `outDir` 与入口喂给 vite。
import { execFile } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { InjectionToken } from "@morlay/zephyr";
import type { ResolvedConfig } from "../config/contract.ts";
import { CliError } from "../errors.ts";
import type { ZephyrLayout } from "../layout.ts";

const execFileAsync = promisify(execFile);

/** 一次构建的输入。 */
export interface BuildInput {
  /** 解析后的工作区配置。 */
  readonly resolved: ResolvedConfig;
  /** 产物布局。 */
  readonly layout: ZephyrLayout;
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
}

/** 三步的值令牌。 */
export const BuildSteps = InjectionToken<BuildSteps>("build-steps");

/** 默认的三步。 */
export function defaultBuildSteps(): BuildSteps {
  return { client: buildClient, runtime: buildRuntime, entry: bundleEntry };
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
  ] as const) {
    const startedAt = Date.now();
    await action(input);
    collected.push({ name, ms: Date.now() - startedAt, detail: detailOf(name, input) });
  }
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
  try {
    await execFileAsync(
      "pnpm",
      [
        "--filter",
        name,
        "deploy",
        "--prod",
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
 * 入口：把 `server.entry` 打成单文件，preview 与桌面壳都跑它。
 * @param input - 工作区配置与布局。
 */
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
