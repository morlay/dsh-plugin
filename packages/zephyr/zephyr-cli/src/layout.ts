// 产物布局：`<outputDir>/` 就是**一份可分发**的应用（设计决定 3、4）。
//
// 五样东西，缺一不成「拷到别处还能起」：
//   client_modules/   静态前端（index.html + 按包联邦产物 + .files.json），纯文件、无服务
//   node_modules/     pnpm deploy --prod 的闭包（含 `@morlay/dsh-oxc-node` 这个 loader）
//   src/server.ts     源码面入口（由 loader 直接跑，不再打 entry.mjs 单文件）
//   bootstrap.mjs     生产态装配（build 生成；部署值内联在这里）
//   package.json      应用清单（部署面）
//
// 根由 `server.outputDir` 给（相对配置文件或绝对），缺省 `target/<应用名>/`：落哪归应用配置，
// 与 vite 的 `build.outDir` 同一习惯。**整目录可删、可整体拷贝**：构建每轮整目录重建，
// 没有要跨轮复用的中间物。
import { basename, join, resolve } from "node:path";

/** 一次构建的全部路径。 */
export interface ZephyrLayout {
  /** 产物根：`<outputDir>`（整目录可删、可分发）。 */
  readonly root: string;
  /** 静态前端：`index.html` + 按包联邦产物（`<pkg>@<ver>/*.js` + `.files.json`）。 */
  readonly clientModules: string;
  /** 宿主闭包（`pnpm deploy --prod` 的结果，含 loader）。 */
  readonly nodeModules: string;
  /** 源码面入口（从应用的 `src/server.ts` 复制；它 import 的包从闭包解析）。 */
  readonly serverEntry: string;
  /** 生产态装配：preview 与桌面壳都跑它。 */
  readonly bootstrap: string;
  /** 应用清单（部署面：`type` / `dependencies`）。 */
  readonly manifest: string;
}

/**
 * 按工作区与配置算出布局。
 * @param workspace - 工作区绝对路径（配置文件所在目录）。
 * @param outputDir - 配置里的 `server.outputDir`（相对工作区或绝对）；缺省 `target/<应用名>`。
 * @param appName - 应用名（缺省目录名的最后一段）。
 * @returns 布局。
 */
export function layoutOf(workspace: string, outputDir?: string, appName?: string): ZephyrLayout {
  const root =
    outputDir === undefined
      ? join(workspace, "target", appName ?? basename(workspace))
      : resolve(workspace, outputDir);
  return {
    root,
    clientModules: join(root, "client_modules"),
    nodeModules: join(root, "node_modules"),
    serverEntry: join(root, "src", "server.ts"),
    bootstrap: join(root, "bootstrap.mjs"),
    manifest: join(root, "package.json"),
  };
}
