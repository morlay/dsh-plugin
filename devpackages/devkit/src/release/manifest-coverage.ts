// 清单覆盖判据（设计「验收判据」第 2 条）：发布包的 `publishConfig.exports` 覆盖顶层 `exports` 每个键，
// 且每个出口目标文件都存在。两个调用方共用这一份：`just publish-npm`（发之前守门）与
// `just verify-release`（验收报告），两处的口径不能各自漂移。
import { stat } from "node:fs/promises";
import { join } from "node:path";

/** 一个出口目标：`types` 与 `default` 都是包内相对路径。 */
export interface ExportTarget {
  readonly types?: string;
  readonly default?: string;
}

/** `exports` 的一份映射：字符串（单一条件）或带 `types` / `default` 的对象。 */
export type ExportsMap = Readonly<Record<string, string | ExportTarget>>;

/** 判据要读的清单字段。 */
export interface CoverageManifest {
  readonly name: string;
  readonly exports?: ExportsMap;
  readonly publishConfig?: { readonly exports?: ExportsMap };
}

/** 一个待判的包：目录用来 `stat` 目标文件。 */
export interface CoveragePackage {
  readonly dir: string;
  readonly manifest: CoverageManifest;
}

/** 一个出口目标里的文件路径（字符串目标就是它自己）。 */
export function targetFiles(target: string | ExportTarget | undefined): string[] {
  if (target === undefined) return [];
  if (typeof target === "string") return [target];
  return [target.types, target.default].filter((each): each is string => each !== undefined);
}

async function exists(path: string): Promise<boolean> {
  return await stat(path).then(
    () => true,
    () => false,
  );
}

/**
 * 一个包的清单覆盖问题；空数组即通过。
 *
 * 判据是「发布态覆盖开发态的每个键 + 目标文件真的在」：`publishConfig.exports` 是**整体替换**，
 * 少一个键消费方就少一个面；目标文件不在，装出来就是 `Cannot find module`。
 *
 * @param pkg - 包目录与清单。
 * @returns 每条问题一行（带包名与出口键），可直接写给人看。
 */
export async function coverageProblems(pkg: CoveragePackage): Promise<string[]> {
  const problems: string[] = [];
  const top = Object.keys(pkg.manifest.exports ?? {});
  const published = pkg.manifest.publishConfig?.exports ?? {};
  const missing = top.filter((key) => !(key in published));
  if (missing.length > 0) {
    problems.push(pkg.manifest.name + ": publishConfig.exports 缺键 " + missing.join(", "));
  }
  for (const [key, target] of Object.entries(published)) {
    for (const file of targetFiles(target)) {
      if (!(await exists(join(pkg.dir, file)))) {
        problems.push(pkg.manifest.name + ": " + key + " → " + file + " 不存在");
      }
    }
  }
  return problems;
}
