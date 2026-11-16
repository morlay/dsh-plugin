// **本包（`zephyr-dev`）自己的包根**：node-stub、联邦 tsconfig 这类构建链资源都在它下面。
//
// 为什么不从 `AppEnv` 取：那是**装配面**的根（`profileDir`），随部署形态变；构建链要的是「代码打在哪」，
// 与部署无关。两者混用会在打包形态下指向不存在的路径（见 `serve-vite` 的 vite root 注释）。
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 本包的根目录（`packages/zephyr/zephyr-dev`）。
 *
 * **惰性求值**：`import.meta.url` 在非 `file:` 运行时里（vitest 的 happy-dom 环境是
 * `http://localhost/…`）会让 `fileURLToPath` 抛 `The URL must be of scheme file`——
 * 写成模块级常量的话，**模块一被求值就崩**。
 * @returns 包根目录的绝对路径。
 */
export function devPackageRoot(): string {
  return dirname(fileURLToPath(new URL("../../package.json", import.meta.url)));
}

/**
 * `node:*` 的 CJS 替身（给 rolldown 直出的产物用）。
 * @returns 替身文件的绝对路径。
 */
export function nodeStubPathOf(): string {
  return join(devPackageRoot(), "src", "node-stub", "node-stub.cjs");
}

/**
 * `node:*` 的 ESM 替身（给 vite 逐文件服务的源码用）。
 * @returns 替身入口的绝对路径。
 */
export function nodeStubEsmPathOf(): string {
  return join(devPackageRoot(), "src", "node-stub", "index.ts");
}

/**
 * 联邦预编译用的 tsconfig（装饰器按 legacy 转译）。
 * @returns 配置文件的绝对路径。
 */
export function federationTsconfigPath(): string {
  return join(devPackageRoot(), "federation.resolve.tsconfig.json");
}

/**
 * 应用页面的根（vite 的 `root`）：**应用自己**的 `src/client`，入口归应用。
 *
 * 从 `profileDir` 推而不是从本包推：页面是应用的文件，不是框架的。
 * @param profileDir - 装配根（`AppEnv.values.profileDir`）。
 * @returns 页面目录的绝对路径。
 */
export function appBootDirOf(profileDir: string): string {
  return join(profileDir, "src", "client");
}
