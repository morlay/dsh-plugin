import { defineConfig } from "vitest/config";

export default defineConfig({
  // 装饰器用 TypeScript 的 legacy 模式：cordis 的 `Service` 子类（含 vendor 里的上游插件）都是这么写的。
  // 不写这条时 oxc 会去最近的 tsconfig 找 `experimentalDecorators`，而 vendor 被根 tsconfig `exclude`
  // ——转译直接抛「decorators require experimentalDecorators」。写在这里是**转译配置**，不是类型配置。
  oxc: { decorator: { legacy: true } },
  test: {
    include: ["**/__tests__/*.spec.tsx", "**/__tests__/*.spec.ts"],
    exclude: ["**/node_modules/**", "target/**", "_packages/**"],
    // 单测里的等待不应该超过 3s：超时即失败，暴露真实原因，而不是把失败拖成 5s 的 vitest 默认超时。
    testTimeout: 3000,
    isolate: true,
  },
});
