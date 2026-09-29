import { defineCordisPluginConfig } from "@local/devkit";
import { defineConfig } from "tsdown";

// 每个能力一个子出口（各自是独立的 cordis 插件，`inject` 互不牵连），所以入口显式列出：装配行写
// `@morlay/dsh-context-assembler/<capability>`。`rows` 出口发布行清单，装配入口在部署那一层
// （`packages/bundles/session-mode-profile`）直接 import 它渲染 patch，于是行清单只有一份真源。
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
