import { defineCordisPluginConfig } from "@local/devkit";
import { defineConfig } from "tsdown";
import { patchHooks } from "./tool/patch.ts";

/**
 * 清单包：`rows` 出口给 preset 引用，包根的 `cordis.patch.yml` 给 profile 直接装配用（同一份真源）。
 */
export default defineConfig(async () => ({
  ...(await defineCordisPluginConfig({ entries: { rows: "./src/rows.ts" } })),
  hooks: patchHooks(),
}));
