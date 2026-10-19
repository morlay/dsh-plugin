import { defineConfig } from "tsdown";
import { cordisPlugin } from "@local/tsdown-plugin-cordis";
import { bundlePatchOf, renderModulePatch, type ModulePatchOptions } from "@local/zephyr-codegen";
import { WebCustomProfileModule } from "./src/zephyr.module.ts";

// patch 真源：行清单从 `WebCustomProfileModule` 推导（差异只在 without 与 @morlay/dsh-client-modules 一行）。
const patch = {
  module: WebCustomProfileModule,
  from: import.meta.url,
} satisfies ModulePatchOptions;

export const render = (): Promise<string> => renderModulePatch(patch);

export default defineConfig({
  entry: { index: "./src/index.ts" },
  plugins: [cordisPlugin(), bundlePatchOf(patch).plugin],
});
