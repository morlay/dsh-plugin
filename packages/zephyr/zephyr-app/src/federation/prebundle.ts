// 构建期的**前端预编译**：把静态面里出现的联邦地址逐个打成产物，落到 `client-modules` 缓存。
//
// 无 ctx：这是纯函数（目标清单 + 布局 + 版本表 → 产物），build 阶段没有运行期装配，也不该有。
// 与 dev 期同一条算法（`bundlePackage`），差异只在「什么时候跑」——dev 按请求跑，build 一次跑完。
import type { ProviderList } from "@morlay/zephyr";
import { bundlePackage, clientModulesAlias } from "./bundle.ts";

/** 一条待预编译的模块。 */
export interface PrebundleTarget {
  /** 包名（`@scope/name`）。 */
  readonly name: string;
  /** 包版本（进地址与缓存键）。 */
  readonly version: string;
  /** 出口名（`index` / `shim/with-selector` / `brand-font.css`）。 */
  readonly exportName: string;
  /** 入口文件绝对路径。 */
  readonly entry: string;
  /** 该包的清单绝对路径（外置依赖的版本表从这里建）。 */
  readonly manifestOf?: string;
}

/** 预编译结果：成功的条数与失败明细（失败不抛，交给调用方决定红）。 */
export interface PrebundleResult {
  /** 成功条数。 */
  readonly built: number;
  /** 失败明细。 */
  readonly failures: readonly { readonly target: PrebundleTarget; readonly reason: string }[];
}

/**
 * 逐条预编译。
 * @param options - 目标清单与布局。
 * @returns 成功条数与失败明细。
 */
export async function prebundleAll(options: {
  readonly targets: readonly PrebundleTarget[];
  /** `client-modules` 缓存根（`<dataDir>/cache/client-modules`）。 */
  readonly cacheRoot: string;
  readonly repoRoot: string;
  /** 浏览器里 `node:*` 的替身文件。 */
  readonly nodeStub: string;
  /** 应用清单（`<workspace>/package.json`）：它的 dependencies 也进 external 表（共享运行时）。 */
  readonly appManifest?: string;
  readonly log?: (message: string) => void;
}): Promise<PrebundleResult> {
  const failures: { target: PrebundleTarget; reason: string }[] = [];
  let built = 0;
  for (const target of options.targets) {
    try {
      const result = await bundlePackage({
        cacheRoot: options.cacheRoot,
        repoRoot: options.repoRoot,
        alias: clientModulesAlias({ repoRoot: options.repoRoot, nodeStub: options.nodeStub }),
        nodeStub: options.nodeStub,
        name: target.name,
        version: target.version,
        input: { [target.exportName]: target.entry },
        watch: [target.entry],
        ...(target.manifestOf === undefined ? {} : { manifestOf: target.manifestOf }),
        ...(options.appManifest === undefined ? {} : { appManifest: options.appManifest }),
        ...(options.log === undefined ? {} : { log: options.log }),
      });
      if (result === undefined) throw new Error("产物为空（入口解析或打包失败）");
      built += 1;
    } catch (error) {
      failures.push({ target, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { built, failures };
}

/** 空清单（类型占位，避免调用方自己写 `[]` 丢类型）。 */
export const NO_PREBUNDLE_TARGETS: ProviderList = [];
