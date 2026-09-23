import { defineCordisPluginConfig } from "@local/devkit";
import { defineConfig } from "tsdown";
import { patchHooks } from "./tool/patch.ts";

/**
 * 每个能力一个子出口（各自是独立的 cordis 插件，`inject` 互不牵连），所以入口是显式列出的：
 * 装配行写 `@morlay/dsh-context-assembler/<capability>`。包根的 `src/index.ts` 是组装出口。
 *
 * `rows` 出口是给"由 preset 引用"那种采用方式的：它导出同一份行清单（`src/rows.ts`），preset 的生成器
 * 直接 import 它，于是 preset 里那批行与本包 bundle patch 永远同源。
 */
export default defineConfig(async () => ({
  ...(await defineCordisPluginConfig({
    entries: {
      rows: "./src/rows.ts",
      assembler: "./src/assembler/index.ts",
      "agent-instructions": "./src/agent-instructions/index.ts",
      "skill-catalog": "./src/skill-catalog/index.ts",
      "tool-guidance": "./src/tool-guidance/index.ts",
      scope: "./src/scope/index.ts",
    },
  })),
  hooks: patchHooks(),
}));
