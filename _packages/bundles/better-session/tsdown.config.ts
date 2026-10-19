import { defineConfig } from "tsdown";
import { cordisPlugin } from "@local/tsdown-plugin-cordis";
import { bundlePatchOf, renderModulePatch, type ModulePatchOptions } from "@local/zephyr-codegen";
import { BetterSessionModule } from "./src/zephyr.module.ts";

// patch 真源：行清单从 `BetterSessionModule` 推导（见 `src/zephyr.module.ts`），生成物是包根那份
// `cordis.patch.yml`，build 时由插件重写。
const patch = {
  module: BetterSessionModule,
  from: import.meta.url,
} satisfies ModulePatchOptions;

export const render = (): Promise<string> => renderModulePatch(patch);

export default defineConfig({
  entry: { index: "./src/index.ts" },
  plugins: [cordisPlugin(), bundlePatchOf(patch).plugin],
});
