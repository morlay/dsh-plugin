import { defineConfig } from "tsdown";
import { cordisPlugin, isLocalPackage } from "@local/tsdown-plugin-cordis";
import { SHELL_INLINE_PACKAGES } from "./src/inline-packages.ts";

// 壳产物只含壳自己的字节（`@local/*` 与 `@morlay/dsh-desktop-host` 内联进来），上游包一律留在产物外——
// 壳可达的模块不许出现上游裸引用，守 `src/__tests__/shell-import-boundary.spec.ts`。
//
// 子出口（appconfig / dshhome / official / profile-project / seed）是 `@local/dshdev`
// 复用同一份事实的入口。
export default [
  defineConfig({
    entry: {
      // Electron 的 app 入口（装配目录的清单 `main` 指引导，引导再加载它）。
      index: "./src/index.ts",
      appconfig: "./src/appconfig.ts",
      dshhome: "./src/dshhome.ts",
      official: "./src/official.ts",
      "profile-project": "./src/profile-project.ts",
      seed: "./src/seed.ts",
      // 壳要内联进产物的包名单（`@local/dshdev` 装配时也读它，避免两处各写一份）。
      "inline-packages": "./src/inline-packages.ts",
    },
    plugins: [
      cordisPlugin({
        inline: SHELL_INLINE_PACKAGES,
        dts: false,
      }),
    ],
  }),
  // preload 必须是 CJS（sandboxed preload 的约束），所以它单独一遍构建；`clean: false`
  // 保住上一遍的壳产物。
  {
    entry: {
      "preload-app": "./src/preload-app.ts",
    },
    outDir: "dist",
    format: ["cjs"],
    platform: "node",
    target: "es2024",
    dts: false,
    clean: false,
    deps: { neverBundle: ["electron"], alwaysBundle: isLocalPackage },
  },
];
