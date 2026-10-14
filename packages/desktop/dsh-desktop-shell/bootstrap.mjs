/**
 * 壳的启动引导（**手写、不参与构建**）。
 *
 * Electron 的 app 目录必须有一个真 JS 入口（它读清单的 `main`，不走 `exports`）。业务代码由 `dshdev` 的
 * prebuild 转译到 `dist/`（**必须转译**：`node_modules` 下的 `.ts` 跑不了——Node 的内建类型剥离对那里是
 * 硬限制，自定义 loader 拦不住），引导只做两件事：报出包根、加载业务入口。
 */
import { fileURLToPath } from "node:url";

// 包根由引导报出（dev / bundle 的装配位置与发布包不同，"相对 `import.meta.url` 数层"会算错）。
globalThis.__DSH_SHELL_ROOT__ = fileURLToPath(new URL("./", import.meta.url));
await import("./dist/index.mjs");
