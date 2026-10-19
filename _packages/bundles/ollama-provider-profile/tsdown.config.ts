import { defineConfig } from "tsdown";
import { cordisPlugin } from "@local/tsdown-plugin-cordis";
import { bundlePatchOf, renderModulePatch, type ModulePatchOptions } from "@local/zephyr-codegen";
import { OllamaProviderProfileModule } from "./src/zephyr.module.ts";

// `@Module` 是 patch 真源：insert 行来自 providers，官方行只覆盖 config。
// 能力包的行名由 Provider 定义文件所属的 package.json 推导，不在这里手写映射。
const patch = {
  module: OllamaProviderProfileModule,
  from: import.meta.url,
} satisfies ModulePatchOptions;

export const render = (): Promise<string> => renderModulePatch(patch);

export default defineConfig({
  plugins: [
    cordisPlugin(),
    bundlePatchOf(patch).plugin,
  ],
});
