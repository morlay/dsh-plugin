import { defineCordisPluginConfig } from "@local/devkit";
import { defineConfig } from "tsdown";

/**
 * 每个能力一个子出口（各自是独立的 cordis 插件，`inject` 互不牵连），所以入口是显式列出的：
 * 装配行写 `@morlay/dsh-context-assembler/<capability>`。包根的 `src/index.ts` 是组装出口。
 *
 * `rows` 出口发布这个能力需要的行清单（`src/rows.ts`）：装配入口在部署那一层
 * （`packages/bundles/session-mode-profile`），bundle 直接 import 它渲染 patch，于是行清单只有一份真源。
 */
export default defineConfig(async () => ({
  ...(await defineCordisPluginConfig({
    entries: {
      rows: "./src/rows.ts",
      assembler: "./src/assembler/index.ts",
      "agent-instructions": "./src/agent-instructions/index.ts",
      "skill-catalog": "./src/skill-catalog/index.ts",
      scope: "./src/scope/index.ts",
    },
  })),
}));
