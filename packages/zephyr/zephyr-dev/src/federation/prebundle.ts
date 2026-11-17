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

/** 一条预编译失败：目标 + 原因（原因原文来自打包器，不加工）。 */
export interface PrebundleFailure {
  /** 失败的目标。 */
  readonly target: PrebundleTarget;
  /** 失败原因（打包器给的那句话）。 */
  readonly reason: string;
}

/** 预编译结果：成功的条数与失败明细（失败不抛，交给调用方决定红）。 */
export interface PrebundleResult {
  /** 成功条数。 */
  readonly built: number;
  /** 失败明细。 */
  readonly failures: readonly PrebundleFailure[];
}

/**
 * 目标按**包**分组（同名同版本同一份清单的多个出口归一组）。
 *
 * 为什么必须分组：`bundlePackage` 的输入本来就是「出口名 → 文件」这张表（多 entry + 共享 chunk），
 * 产物清单 `.files.json` 也是**整包一份**。逐条目标各调一次的话，同一个包会被重复构建 N 次，
 * 而且后一次的清单把前一次的条目**覆盖**掉（盘上的文件还在、清单里没了）——`@shikijs/langs`
 * 的 60 个语言包就是 60 次构建 + 59 次覆盖。
 * @param targets - 目标清单。
 * @returns 分组后的条目（组内保持清单顺序）。
 */
export function groupTargetsByPackage(
  targets: readonly PrebundleTarget[],
): { readonly key: string; readonly targets: readonly PrebundleTarget[] }[] {
  const groups = new Map<string, PrebundleTarget[]>();
  for (const target of targets) {
    // 键里带清单路径：pnpm 严格布局下同名同版本可以是**两份**实体（不同引用方各装一个副本），
    // 而它们的产物目录名一样（`<pkg>@<ver>`）——合并成一组建出来的产物不该混用另一份的解析面。
    const key = `${target.name}@${target.version}::${target.manifestOf ?? ""}`;
    const list = groups.get(key) ?? [];
    list.push(target);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([key, list]) => ({ key, targets: list }));
}

/**
 * 逐包预编译。
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
  const failures: PrebundleFailure[] = [];
  let built = 0;
  for (const group of groupTargetsByPackage(options.targets)) {
    const [first] = group.targets;
    if (first === undefined) continue;
    const input: Record<string, string> = {};
    for (const target of group.targets) input[target.exportName] = target.entry;
    try {
      const result = await bundlePackage({
        cacheRoot: options.cacheRoot,
        repoRoot: options.repoRoot,
        alias: clientModulesAlias({ repoRoot: options.repoRoot, nodeStub: options.nodeStub }),
        nodeStub: options.nodeStub,
        name: first.name,
        version: first.version,
        input,
        watch: group.targets.map((target) => target.entry),
        ...(first.manifestOf === undefined ? {} : { manifestOf: first.manifestOf }),
        ...(options.appManifest === undefined ? {} : { appManifest: options.appManifest }),
        ...(options.log === undefined ? {} : { log: options.log }),
      });
      if (result === undefined) throw new Error("产物为空（入口解析或打包失败）");
      built += group.targets.length;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      // 一组失败就把组里每个出口都记一条：调用方手里是「出口清单」，报错也该按那个粒度。
      for (const target of group.targets) failures.push({ target, reason });
    }
  }
  return { built, failures };
}

/** 空清单（类型占位，避免调用方自己写 `[]` 丢类型）。 */
export const NO_PREBUNDLE_TARGETS: ProviderList = [];
