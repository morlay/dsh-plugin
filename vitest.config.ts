import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/__tests__/*.spec.tsx", "**/__tests__/*.spec.ts"],
    exclude: ["**/node_modules/**", "target/**", "_packages/**"],
    // 单测里的等待不应该超过 3s：超时即失败，暴露真实原因，而不是把失败拖成 5s 的 vitest 默认超时。
    testTimeout: 3000,
  },
});
