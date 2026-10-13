/**
 * 壳的启动引导（**手写、不参与构建**）。
 *
 * Electron 的 app 目录必须有一个**真 JS** 入口（它读清单的 `main`，不走 `exports`），而这个仓库的壳代码是
 * TypeScript。打包后的 Electron **不读 `NODE_OPTIONS`**（`Most NODE_OPTIONs are not supported in packaged
 * apps`），所以 loader 只能在**运行期**注册——`node:module` 的 `register()` 正是为此。
 *
 * 这样开发与打包两种形态都不需要"先构建壳"：入口就是这份引导，业务代码由 loader 直接跑 `src/`。
 */
import { register } from "node:module";
import { fileURLToPath } from "node:url";

// 与工作区其它地方同一份 TS 注册（`@oxc-node/core/register`）：上游包经 exports 指到 src 后，Node 原生
// 的 strip-only 不支持 parameter properties / enum / 装饰器，这一层转译必须挂上。
register("@oxc-node/core/register", import.meta.url);

// 业务代码在两种形态下的位置不同（dev/bundle 跑 `src/`，发布包跑 `dist/`），"相对 `import.meta.url`
// 数几层"这种算法会错。引导**就在包根**，所以由它把包根报出来。
globalThis.__DSH_SHELL_ROOT__ = fileURLToPath(new URL("./", import.meta.url));
await import("./src/index.ts");
