// 产物布局：`node_modules/.zephyr/{dist,runtime,cache}`。
//
// 三样东西的共同点是「可以整目录删掉」：静态面（dist）、运行时闭包（runtime）、构建缓存（cache）。
// 根放在 **node_modules 下**：那本来就是「装出来、可重建、不进版本库」的域（与 vite 的 `.vite` 同级），
// 工作区根因此不会被产物污染，也不需要在 `.gitignore` 里再加一条。
import { join, resolve } from "node:path";

/** 一次构建的全部路径。 */
export interface ZephyrLayout {
  /** 产物根（缺省 `node_modules/.zephyr`，可被配置覆盖）。 */
  readonly root: string;
  /** 静态面：`index.html` + 资源 + 各包联邦产物。 */
  readonly dist: string;
  /** 运行时闭包（`pnpm deploy` 的结果）+ `entry.mjs`。 */
  readonly runtime: string;
  /** 构建缓存（rolldown / vite）。 */
  readonly cache: string;
  /** 预览与桌面壳都跑它。 */
  readonly entry: string;
}

/**
 * 按工作区与可选的产出根算出布局。
 * @param workspace - 工作区绝对路径。
 * @param outDir - 配置里的 `build.outDir`（相对工作区或绝对）；缺省 `node_modules/.zephyr`。
 * @returns 布局。
 */
export function layoutOf(workspace: string, outDir?: string): ZephyrLayout {
  const root =
    outDir === undefined ? join(workspace, "node_modules", ".zephyr") : resolve(workspace, outDir);
  return {
    root,
    dist: join(root, "dist"),
    runtime: join(root, "runtime"),
    cache: join(root, "cache"),
    entry: join(root, "runtime", "entry.mjs"),
  };
}
