import { defineConfig } from "vitest/config";

// 装饰器：Vite 的 oxc 转换显式 Omit 了 `tsconfig`（传不进 `experimentalDecorators`），但 oxc 自己的
// 变换选项留了下来——字段名是**单数** `decorator`（rolldown binding 的 `DecoratorOptions`），
// `legacy: true` 即 legacy（experimentalDecorators）降级。
//
// `execArgv`：上游包经 exports 指到 src 后，测试里的 cordis Loader 用**运行期动态 import** 加载这些 `.ts`
// （不经 Vite 的模块图），所以 worker 进程也要挂 oxc loader——否则那些行 import 失败，报 `never started`。
// 写端是双协议实现，见 `patches/decorator-dual-protocol.patch`。
const TS_LOADER = import.meta.resolve("@local/devkit/ts-loader");

export default defineConfig({
  oxc: { decorator: { legacy: true } },
  test: {
    pool: "forks",
    // Vitest 4+ 把原来的 `poolOptions.forks.execArgv` 提成了顶层选项。
    execArgv: [`--import=${TS_LOADER}`],
    include: [
      // `packages/**` 含装配入口（`packages/bundles/*`，patch 与生成物同形、共享行内容一致的守护测试）。
      // `src/client/__tests__/**` 是 client 面（浏览器半）的测试：按 face 与宿主面的测试分开住。
      "packages/**/src/__tests__/**/*.spec.ts",
      "packages/**/src/__tests__/**/*.spec.tsx",
      "packages/**/src/client/__tests__/**/*.spec.ts",
      "packages/**/src/client/__tests__/**/*.spec.tsx",
      // 共享工具链（@local/devkit）的测试与被它服务的包同形：src/__tests__/*.spec.ts。
      "devpackages/**/src/__tests__/**/*.spec.ts",
    ],
    exclude: ["**/node_modules/**", "target/**"],
  },
});
