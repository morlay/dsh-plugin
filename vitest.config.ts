import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
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
    isolate: true
  },
});
