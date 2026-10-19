import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      // `packages/**` 含装配入口（`packages/bundles/*`，patch 与生成物同形、共享行内容一致的守护测试）。
      // `src/client/__tests__/**` 是 client 面（浏览器半）的测试：按 face 与宿主面的测试分开住。
      "packages/**/src/__tests__/**/*.spec.ts",
      "packages/**/src/__tests__/**/*.spec.tsx",
      // 域内测试就近住被测代码的子目录（`src/<domain>/__tests__`），与包根 `src/__tests__` 同级。
      "packages/**/src/*/__tests__/**/*.spec.ts",
      "packages/**/src/*/__tests__/**/*.spec.tsx",
      // 更深的域内测试（`src/client/renderer/__tests__` 这类：契约面就近住实现旁边）。
      "packages/**/src/**/__tests__/**/*.spec.ts",
      "packages/**/src/**/__tests__/**/*.spec.tsx",
      "packages/**/src/client/__tests__/**/*.spec.ts",
      "packages/**/src/client/__tests__/**/*.spec.tsx",
      // 共享工具链（@local/devkit）的测试与被它服务的包同形：src/__tests__/*.spec.ts。
      "devpackages/**/src/__tests__/**/*.spec.ts",
      // 应用入口（自研 launcher）的装配判据：入口 Module 能否直接装起来。
      "apps/**/src/__tests__/**/*.spec.ts",
    ],
    exclude: ["**/node_modules/**", "target/**"],
    // 单测里的等待不应该超过 3s：超时即失败，暴露真实原因，而不是把失败拖成 5s 的 vitest 默认超时。
    testTimeout: 3000,
  },
});
