import { defineCordisPluginConfig, isLocalPackage } from "@local/devkit";

// 壳与工具分家的边界：`app.asar` 里只有壳自己的字节（`@local/*` 与 `@morlay/dsh-desktop-host`
// 内联进来），上游包一律留在产物外——所以壳可达的模块不许出现上游裸引用，守
// `src/__tests__/shell-import-boundary.spec.ts`。
//
// 子出口（appconfig / dshhome / official / profile-project / seed）是 `@morlay/dsh-desktopify`
// 复用同一份事实的入口：种子、官方包清单、home 解析都只有这一份实现，壳与 CLI 都引它。
export default [
  await defineCordisPluginConfig({
    entries: {
      appconfig: "./src/appconfig.ts",
      dshhome: "./src/dshhome.ts",
      official: "./src/official.ts",
      "profile-project": "./src/profile-project.ts",
      seed: "./src/seed.ts",
    },
    inline: ["@morlay/dsh-desktop-host"],
    // dev 与 bundle 都以**本包目录**为 Electron app：Electron 按包清单的 `main` 找壳入口，
    // 所以壳包必须有传统入口（值由构建写回，指 `dist/index.mjs`）。
    legacy: true,
    dts: false,
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
