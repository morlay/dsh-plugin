import { defineConfig } from "tsdown";
import { cordisPlugin } from "@local/tsdown-plugin-cordis";
import { bundlePatch } from "@local/devkit/patch";
import { renderModulePatch, rowsOf, type ModulePatchOptions } from "@local/zephyr-codegen";
import { SandboxProfileModule } from "./src/zephyr.module.ts";

const patch = {
  module: SandboxProfileModule,
  from: import.meta.url,
  packageNameOfRow: (id: string) =>
    id === "sandbox-local" ? "@morlay/dsh-sandbox-local" : undefined,
} satisfies ModulePatchOptions;

export const render = (): Promise<string> => renderModulePatch(patch);

export default defineConfig({
  plugins: [cordisPlugin(), bundlePatch({ from: patch.from, rows: () => rowsOf(patch.module, patch) })],
});
