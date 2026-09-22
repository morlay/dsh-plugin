import { defineCordisPluginConfig } from "@local/devkit";

/**
 * 每个能力一个子出口（各自是独立的 cordis 插件，`inject` 互不牵连），所以入口是显式列出的：
 * 装配行写 `@morlay/dsh-context/<capability>`。包根的 `src/index.ts` 只是 devkit 约定的占位。
 */
export default defineCordisPluginConfig({
  entries: {
    assembler: "./src/assembler/index.ts",
    "agent-instructions": "./src/agent-instructions/index.ts",
    "skill-catalog": "./src/skill-catalog/index.ts",
    reference: "./src/reference/index.ts",
    "tool-guidance": "./src/tool-guidance/index.ts",
    scope: "./src/scope/index.ts",
  },
});
