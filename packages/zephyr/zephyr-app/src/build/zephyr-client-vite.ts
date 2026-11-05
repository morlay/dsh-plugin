// 静态面构建用的 **vite 配置片段**：把 dev 那套解析规则原样交给 `vite build`。
//
// 为什么是「片段」而不是「构建器行」：build 不需要装配任何清单，它需要的只是解析规则。
// 应用在自己的 `vite.config.ts` 里展开这一段，CLI 只把 `outDir` / root / 入口喂给 vite——
// 于是规则只有一个 home（本包），CLI 与框架之间也不必再互相认识。
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { clientModulesAlias } from "../federation/bundle.ts";

/** 片段需要的部署值。 */
export interface ZephyrClientViteOptions {
  /** 仓库根（源码形态是工作区；闭包形态是闭包目录）：`@/…` 别名与依赖解析的基准。 */
  readonly repoRoot: string;
  /** node 内置的浏览器替身路径；缺省用本包自带的那份。 */
  readonly nodeStub?: string;
}

/**
 * 本包根（`src/build/` 往上两层）。
 * @returns 绝对路径。
 */
function packageRootOf(): string {
  return dirname(fileURLToPath(new URL("../../package.json", import.meta.url)));
}

/**
 * 生成 vite 配置片段：`define` / `oxc` 装饰器 / `@/` 与 `node:*` 的别名。
 *
 * 这几项必须与 dev 同源：换成两套解析，就会出现「dev 能跑、build 白屏」。
 * @param options - 仓库根与可选的 node 替身。
 * @returns 可以直接展开进 `defineConfig({ ...zephyrClientViteConfig() })` 的对象。
 */
export function zephyrClientViteConfig(options: ZephyrClientViteOptions) {
  return {
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
      "process.env": "{ env: {} }",
      process: "{ env: {} }",
      __DEFINES__: "{}",
    },
    oxc: { target: "esnext", decorator: { legacy: true } },
    resolve: {
      alias: clientModulesAlias({
        repoRoot: options.repoRoot,
        nodeStub: options.nodeStub ?? join(packageRootOf(), "src", "node-stub", "index.ts"),
      }),
    },
  };
}
