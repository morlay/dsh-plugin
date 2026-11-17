import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: { decorator: { legacy: true } },
  test: {
    include: ["**/__tests__/**/*.spec.tsx", "**/__tests__/**/*.spec.ts"],
    // `.scratch/**`：临时产物目录（交接、票据、探针，还有别人放的备份）——它不是仓库的一部分，
    // 里面出现的 `*.spec.ts` 也不该被当成测试跑（否则别人一份备份就能让全库红）。
    exclude: ["**/node_modules/**", "target/**", ".scratch/**"],
    // 单测里的等待不应该超过 3s：超时即失败，暴露真实原因，而不是把失败拖成 5s 的 vitest 默认超时。
    testTimeout: 3000,
    isolate: true,
  },
});
