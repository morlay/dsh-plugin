// 构建器的**前端预编译面**：`compile(options)`——应用 client 入口的静态 import 图 → 一堆联邦产物。
// 无 ctx、无装配：build 阶段没有运行期行树，也不该有。
//
// 它从 `zephyr-cli` 的 `buildPrebundle` 整块搬来（T4），**判据一字未改**：
//   · 清单来自 `planPrebundle`（应用 client 入口的静态 import 图）；
//   · `REQUIRED_PREBUNDLE` 是三个已知包的断言，缺一个即失败；
//   · 清单为空 / 缺已知包 → 抛错；逐条 `bundlePackage` 的失败汇总进结果，由调用方决定红；
//   · 产物落在调用方给的 `cacheRoot`（本票仍是 `<dataDir>/cache/client-modules`）。
// CLI 侧只剩一层薄壳（把结果翻成 `CliError`、保留 `--no-prebundle` 开关）。
import { join } from "node:path";
import { CLIENT_MODULES_CACHE_NAMESPACE } from "../federation/bundle.ts";
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
 * `shiki` 现在仍缺（grammar 家族按 `exports` 逐个枚举，规则在下一票）：这条断言因此在
 * `just custom build` 上会红——**这是预期的**，放宽它等于把「清单不完整」变成静默降级。
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
  /** 数据目录的原始写法（`workspace` / `xdg` / 绝对路径，诊断用）；缺省 `workspace`。 */
  readonly dataDirSpec?: string;
  /** 前端产物的落点（本票仍是 `<dataDir>/cache/client-modules`；由调用方算，见 `cacheRootOf`）。 */
  readonly cacheRoot: string;
}

/** 一次预编译的结果：成功条数与失败明细（空清单 / 缺已知包是**抛错**，不进这里）。 */
export interface CompileResult {
  /** 成功条数。 */
  readonly built: number;
  /** 失败明细（调用方决定红：CLI 翻成 `CliError`）。 */
  readonly failures: readonly PrebundleFailure[];
}

/**
 * 把应用前端图编译成联邦产物。
 * @param options - 工作区、诊断信息与产物落点。
 * @returns 成功条数与失败明细。
 * @throws Error 清单为空，或缺 `REQUIRED_PREBUNDLE` 里的已知包（都是构建失败，不静默降级）。
 */
export async function compile(options: CompileOptions): Promise<CompileResult> {
  const appManifest = join(options.workspace, "package.json");
  const clientEntry = join(options.workspace, "src", "client", "app-boot.ts");
  const plan = await planPrebundle({ entry: clientEntry, appManifest });
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
  // 产物落点由调用方给：数据根的三态写法是**部署值**（`resolveDataDir` 的 home 在 CLI），这里不认识它。
  const result = await prebundleAll({
    targets: [...plan.targets],
    cacheRoot: options.cacheRoot,
    repoRoot: options.workspace,
    nodeStub: nodeStubPathOf(),
    appManifest,
  });
  return { built: result.built, failures: result.failures };
}

/**
 * 前端产物的缓存根：`<dataDir>/cache/client-modules`（与 `AppEnv.cacheDirOf("client-modules")` 同口径）。
 *
 * 它住在**构建器**而不是 CLI：dev（按请求产出）与 build（一次产出）共用同一条规则，
 * 两处各拼一次就有一处会漂移。入参是**已解析**的数据根——三态写法归 CLI。
 * @param dataDir - 数据根（绝对路径）。
 * @returns 缓存根。
 */
export function cacheRootOf(dataDir: string): string {
  return join(dataDir, "cache", CLIENT_MODULES_CACHE_NAMESPACE);
}

/**
 * 失败时那行上下文：哪个应用、从哪个入口枚举、数据根写法、产物落哪。
 *
 * 为什么要它：`--data-dir=xdg` 与默认 `workspace` 下的同一个失败，要改的东西不同
 * （一个是缓存位置、一个是清单内容）；只打入口路径时读的人还得自己把这几件事拼起来。
 * @param options - 预编译输入。
 * @param clientEntry - 枚举起点。
 * @returns 一行诊断。
 */
function diagnosticOf(options: CompileOptions, clientEntry: string): string {
  return `应用 ${options.appName} · 入口 ${clientEntry} · 数据根写法 ${options.dataDirSpec ?? "workspace"} · 产物落 ${options.cacheRoot}`;
}