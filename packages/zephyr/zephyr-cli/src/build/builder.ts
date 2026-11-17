// 构建：**三步**——前端静态目录、运行时闭包、生产态装配。
//
// 三步都是外部动作（联邦预编译 / pnpm / 复制与写文件）。它们不装配任何清单：构建的输入是
// 「布局 + 解析规则」，不是运行期行树——装一棵树只为拿一个构建器，会顺手把服务起起来、
// 把库打开，代价与收益不成比例。
//
// **不打包 node 侧**（设计决定 8）：闭包里本来就有 loader（`@morlay/dsh-oxc-node`），
// `src/server.ts` 原样复制过去、由 loader 直接跑，少一次 rolldown，也让 stack trace 指向真实文件。
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createRequire as createRequireOf } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { InjectionToken } from "@morlay/zephyr";
import { compile } from "@morlay/zephyr-dev";
import type { ResolvedConfig } from "../config/contract.ts";
import { CliError } from "../errors.ts";
import type { ZephyrLayout } from "../layout.ts";

const execFileAsync = promisify(execFile);

/**
 * 删产物目录的参数：`fs.rm` 在 pnpm 的 `.pnpm` 树（几万个小文件 + 大量 symlink）上会偶发 `ENOTEMPTY`，
 * 重试是给这条竞态的——不重试时它不报错，而是「删一半」，下一次 deploy 装进半成品闭包。
 */
const REMOVE_PRODUCT = { recursive: true, force: true, maxRetries: 5, retryDelay: 200 } as const;

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
  /** 产物根（整目录可分发）。 */
  readonly outputDir: string;
}

/** 三步的集合：命令只负责编排与汇总，动作在这里（单测替换成替身即可判编排）。 */
export interface BuildSteps {
  /** 第一步：应用 client 图 → `client_modules/`（含 `index.html`）。 */
  readonly client: (input: BuildInput) => Promise<void>;
  /** 第二步：`pnpm deploy --prod` → `node_modules/`。 */
  readonly runtime: (input: BuildInput) => Promise<void>;
  /** 第三步：复制 `src/server.ts`、写清单与 `bootstrap.mjs`、删 `src/client`。 */
  readonly entry: (input: BuildInput) => Promise<void>;
}

/** 三步的值令牌。 */
export const BuildSteps = InjectionToken<BuildSteps>("build-steps");

/** 默认的三步。 */
export function defaultBuildSteps(): BuildSteps {
  return {
    client: buildClient,
    runtime: buildRuntime,
    entry: assembleEntry,
  };
}

/**
 * 按顺序跑三步并汇总。
 * @param input - 工作区配置与布局。
 * @param steps - 三步的实现（缺省是真实动作）。
 * @returns 每步的耗时与产物根。
 */
export async function runBuild(
  input: BuildInput,
  steps: BuildSteps = defaultBuildSteps(),
): Promise<BuildSummary> {
  const collected: BuildStep[] = [];
  // 产物整目录重建（设计决定 3）：上一次留下的东西一律不留，连着跑两次结果一致。
  await rm(input.layout.root, REMOVE_PRODUCT);
  await mkdir(input.layout.clientModules, { recursive: true });

  for (const [name, action] of [
    ["前端静态目录", steps.client],
    ["运行时闭包", steps.runtime],
    ["生产态装配", steps.entry],
  ] as const) {
    const startedAt = Date.now();
    await action(input);
    collected.push({ name, ms: Date.now() - startedAt, detail: detailOf(name, input) });
  }
  // 三步都完成才冒烟：`bootstrap.mjs` 是第三步的产物，前两步跑完时它还不存在。
  await smokeClosure(input.layout);
  return { steps: collected, outputDir: input.layout.root };
}

/**
 * 汇总里那一行细节：每步产出的位置。
 * @param name - 步骤名。
 * @param input - 布局。
 * @returns 位置。
 */
function detailOf(name: string, input: BuildInput): string {
  if (name === "前端静态目录") return input.layout.clientModules;
  if (name === "运行时闭包") return input.layout.nodeModules;
  return input.layout.bootstrap;
}

/**
 * 第一步：前端产物 → `<outputDir>/client_modules`（静态目录，设计决定 5）。
 *
 * 算法全在 `@morlay/zephyr-dev` 的 `compile()`（枚举清单、断言已知包、打包与落盘都只有一份）；
 * 这里只把**产物落点**给它——dev 与 build 是同一语义、只换目录（设计决定 7）。
 * @param input - 工作区配置与布局。
 */
export async function buildClient(input: BuildInput): Promise<void> {
  const result = await compile({
    workspace: input.resolved.workspace,
    appName: input.resolved.appName,
    outDir: input.layout.clientModules,
    pageEntry: input.resolved.clientEntry,
  }).catch((error: unknown) => {
    // 判据错误（空清单 / 缺已知包）原文已经说清了是什么，只换类型不换措辞。
    throw error instanceof CliError
      ? error
      : new CliError(error instanceof Error ? error.message : String(error));
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
 * 第二步：运行时闭包 `pnpm deploy --prod` → `<outputDir>/node_modules`。
 *
 * `strictDepBuilds=false`：deploy 会在目标目录重装一次，工作区里批准的构建脚本不会自动跟过去；
 * 不放开这一条，闭包会停在 `ERR_PNPM_IGNORED_BUILDS` 上。
 *
 * **为什么 deploy 到临时目录再并进来**：`pnpm deploy` 要求目标目录不存在或为空
 * （否则 `ERR_PNPM_DEPLOY_DIR_NOT_EMPTY`），而 `<outputDir>` 根上要放 `package.json`、
 * `src/`、`client_modules/`、`bootstrap.mjs`——它不是空目录，也不能为了 deploy 先清空。
 * 于是 deploy 到 `<outputDir>/../.zephyr-deploy-<随机>`，再把它产出的 **`node_modules`** 搬进
 * `<outputDir>/node_modules`。deploy 还会写一份包自己的文件副本（`package.json` / `src/`），
 * 那些**不搬**：清单与源码面入口由第三步显式写，两处都写就多一个 home。
 * @param input - 工作区配置与布局。
 */
export async function buildRuntime(input: BuildInput): Promise<void> {
  const name = await appPackageNameOf(input.resolved.workspace);
  const staging = await mkdtemp(join(dirname(input.layout.root), ".zephyr-deploy-"));
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
        staging,
      ],
      { cwd: input.resolved.workspace, maxBuffer: 64 * 1024 * 1024 },
    );
    await resetClosure(input.layout);
    await cp(join(staging, "node_modules"), input.layout.nodeModules, {
      recursive: true,
      verbatimSymlinks: true,
    });
  } catch (error) {
    throw new CliError(
      `运行时闭包失败（pnpm --filter ${name} deploy --prod）：${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/**
 * 第三步：生产态装配——复制源码面入口、写清单与 `bootstrap.mjs`、删前端源码。
 *
 * 三件事都是「产物定型」：`src/server.ts` 原样复制（它 import 的 `@morlay/*` 从
 * `<outputDir>/node_modules` 解析），`bootstrap.mjs` 把部署值（产物根、形态）写死，
 * `src/client` 删掉（前端已在 `client_modules/` 里，留着等于分发源码，设计 §八）。
 * @param input - 工作区配置与布局。
 */
export async function assembleEntry(input: BuildInput): Promise<void> {
  const serverDir = dirname(input.layout.serverEntry);
  await mkdir(serverDir, { recursive: true });
  await copyWorkspaceSources(dirname(input.resolved.serverEntry), serverDir);
  await writeFile(input.layout.manifest, await manifestOf(input), "utf8");
  await writeFile(input.layout.bootstrap, bootstrapSourceOf(), "utf8");
  // 前端源码已在 `client_modules/` 的产物里：留着等于分发源码（设计 §八）。
  await rm(join(input.layout.root, "src", "client"), { recursive: true, force: true });
}

/**
 * 应用清单（产物里的那份）：`type: module` + 应用自己的元信息 + 依赖清单。
 *
 * 依赖清单原样保留：闭包里装的就是它们（`pnpm deploy --prod` 按同一份清单算的），
 * 少一份读的人就得回去翻源码树。
 * @param input - 工作区配置与布局。
 * @returns 序列化后的清单。
 */
async function manifestOf(input: BuildInput): Promise<string> {
  const raw = await readFile(join(input.resolved.workspace, "package.json"), "utf8");
  const source = JSON.parse(raw) as Record<string, unknown>;
  const manifest = {
    name: source["name"],
    version: source["version"],
    private: true,
    type: "module",
    dependencies: source["dependencies"],
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * 把服务端入口**同目录**的工作区源码一起复制过去。
 *
 * 只复制 `src/server.ts` 会让产物里的相对 import（`./zephyr.provide.ts` 这类）落空——
 * 闭包装的是第三方与 workspace 包，不装应用自己的源码。
 * @param source - 源码目录（应用 `src/`）。
 * @param target - 产物里的目标目录（`<outputDir>/src`）。
 */
async function copyWorkspaceSources(source: string, target: string): Promise<void> {
  for (const item of await readdir(source, { withFileTypes: true })) {
    if (!item.isFile()) continue;
    if (!/\.[cm]?[jt]sx?$/u.test(item.name)) continue;
    await cp(join(source, item.name), join(target, item.name), { verbatimSymlinks: true });
  }
}

/**
 * `bootstrap.mjs`：生产态装配（设计 §八 的那一份，**不引开发运行时那个包**）。
 *
 * 为什么生成而不是写进应用源码：生产态的行（静态目录投递）由 `zephyr-app` 提供；而应用源码不该
 * 知道自己在生产态。生成这个文件 = 把形态判断从源码挪到构建产物。
 *
 * 部署值分两半（设计 §八）：构建期确定的（`profileDir` / 产物根 / 形态）在这里写死；
 * 可变的（`--data-dir` / `--port` / `--cwd`）由启动参数给。
 *
 * **必须走 `fileURLToPath`**：产物目录可能含空格（应用名进路径，如 `Zephyr Custom`），
 * 而 `new URL(...).pathname` 会把空格转义成 `%20`——那样读的是另一个不存在的目录。
 * @returns 源码（ESM）。
 */
export function bootstrapSourceOf(): string {
  return [
    "// 由 zephyr build 生成，不是源码。",
    'import { dirname } from "node:path";',
    'import { fileURLToPath } from "node:url";',
    'import providers from "./src/server.ts";',
    "",
    "// 装配根：本文件所在的目录（**不带尾斜杠**：它会成为 `AppEnv.profileDir`，各处按它拼路径）。",
    "const PROFILE_DIR = dirname(fileURLToPath(import.meta.url));",
    'const CLIENT_MODULES_DIR = fileURLToPath(new URL("./client_modules/", import.meta.url));',
    "// 启动参数 --cwd 覆盖；缺省是进程 cwd（从哪个项目目录启动，就在哪儿干活）。",
    "const DEFAULT_WORKING_DIRECTORY = process.cwd();",
    "process.chdir(DEFAULT_WORKING_DIRECTORY);",
    "",
    "export default async function (mode) {",
    '  const { bootstrapApplication } = await import("@morlay/zephyr");',
    '  const { productionProviders, WebServer } = await import("@morlay/zephyr-app");',
    "  const app = await bootstrapApplication({",
    "    providers: [",
    "      ...productionProviders({ clientModulesDir: CLIENT_MODULES_DIR }),",
    "      // 部署值并进 mode 交给应用清单：AppEnv 由它装（两处都装会重复注册）。",
    "      ...providers({",
    "        ...mode,",
    "        profileDir: PROFILE_DIR,",
    "        defaultWorkingDirectory: DEFAULT_WORKING_DIRECTORY,",
    "      }),",
    "    ],",
    "  });",
    "  // **实际监听地址回写同进程环境**：期望端口被占时 `WebServer` 会顺延（换一个能用的端口），",
    "  // preview 与桌面壳都要按**实际**端口打开页面——否则窗口指向一个没人监听的端口。",
    "  const web = app.get(WebServer);",
    '  if (web !== undefined) process.env.ZEPHYR_SERVER_URL = `http://${web.host}:${web.port}/`;',
    "  return app;",
    "}",
    "",
  ].join("\n");
}

/**
 * 闭包冒烟：**把整个产物复制到仓外**再用闭包里的 loader 起 `bootstrap.mjs`。
 *
 * 必须在仓外：在仓库内加载时，Node 会顺着目录往上找到工作区自己的 `node_modules`，
 * 把"闭包里缺这个包"变成"仓库里有"——这正是"只有打包时才炸"的那类静默失败。
 * 产物不齐就跳过：装配级用例（`runBuild` 配假 steps）没有真闭包，那一步冒烟没有意义——
 * 「没东西可冒烟」不等于「冒烟失败」。
 * @param layout - 产物布局。
 * @returns `skipped`（没有闭包或没有装配文件）或 `ok`（真加载过）。
 */
export async function smokeClosure(layout: ZephyrLayout): Promise<"skipped" | "ok"> {
  const present = await Promise.all(
    [layout.nodeModules, layout.bootstrap, layout.serverEntry].map((path) =>
      stat(path).then(
        () => true,
        () => false,
      ),
    ),
  );
  if (present.includes(false)) return "skipped";
  const sandbox = await mkdtemp(join(tmpdir(), "zephyr-closure-"));
  try {
    await cp(layout.root, sandbox, { recursive: true, verbatimSymlinks: true });
    // loader 从**闭包**里解析：产物自带启动器（见设计「二、现状事实」最后一条）。
    const loader = createRequireOf(join(sandbox, "package.json")).resolve("@morlay/dsh-oxc-node");
    const entry = pathToFileURL(join(sandbox, "bootstrap.mjs")).href;
    await execFileAsync(
      process.execPath,
      ["--import", loader, "--input-type=module", "-e", `await import(${JSON.stringify(entry)})`],
      {
        cwd: sandbox,
        // 摘掉工作区的 nodeOptions（--import @oxc-node/core/register）：那份 loader 只装在仓库里，
        // 闭包里没有它；闭包的 loader 由上面的 --import 显式给。
        env: { ...process.env, NODE_OPTIONS: "" },
        timeout: 180_000,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    return "ok";
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CliError(
      `产物不自包含（${layout.root} 复制到仓库外就加载不起来）：\n` +
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
export async function resetClosure(layout: ZephyrLayout): Promise<void> {
  await rm(layout.nodeModules, REMOVE_PRODUCT);
}

/**
 * 应用包名（`pnpm --filter <名字> deploy` 用）。
 * @param workspace - 应用工作区。
 * @returns 包名（读不到清单时退回目录名）。
 */
async function appPackageNameOf(workspace: string): Promise<string> {
  const raw = await readFile(join(workspace, "package.json"), "utf8").catch(() => undefined);
  if (raw === undefined) return basename(workspace);
  return (JSON.parse(raw) as { name?: string }).name ?? basename(workspace);
}
