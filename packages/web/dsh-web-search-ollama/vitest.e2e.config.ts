import { defineConfig } from "vitest/config";

/**
 * e2e 专用配置：真打外网的用例只由
 * `pnpm --filter @morlay/dsh-web-search-ollama run test:e2e` 触发。
 *
 * 根 `vitest.config.ts` 只收 `packages/**\/src/__tests__/`，所以默认的 `just test` 不会碰到
 * `e2e/`——这是刻意的：这类用例一旦被默认收集，环境里有 key 就会静悄悄打外网。
 */
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ["e2e/**/*.e2e.spec.ts"],
    exclude: ["**/node_modules/**", "target/**"],
  },
});
