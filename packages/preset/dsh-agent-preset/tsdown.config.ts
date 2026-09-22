import { defineCordisPluginConfig } from "@local/devkit";
import { defineConfig } from "tsdown";
import { patchHooks } from "./tool/patch.ts";

export default defineConfig(async () => ({
  ...(await defineCordisPluginConfig({ entries: { "relax-intent": "./src/relax-intent.ts" } })),
  hooks: patchHooks(),
}));
