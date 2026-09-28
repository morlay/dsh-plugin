import { defineCordisPluginConfig } from "@local/devkit";
import { bundlePatch, renderPatch, type PatchBundleOptions } from "@local/devkit/patch";
import { defineConfig } from "tsdown";
import { sandboxRows } from "@morlay/dsh-sandbox-local/rows";

const ROWS: readonly unknown[] = [
  // 共享 client 行：本 bundle 的 client 半 inject 它们。**同 id 重复插入是幂等的**——Loader 对同 id
  // 复用同一个 Entry（后者胜），所以每个 bundle 都插齐自己需要的那几行，单独装也能用。
  { insert: [{ id: "ui-primitives-fork", name: "@morlay/dsh-client-ui-primitives" }] },
  ...sandboxRows(),
  {
    id: "sandbox-local",
    config: {
      access: [
        "rw /tmp",
        "rw {{ env.XDG_CACHE_HOME }}",
        "rw {{ env.XDG_STATE_HOME }}",
        "rw {{ env.XDG_DATA_HOME }}",
        "r- {{ env.XDG_CONFIG_HOME }}",
        "-- mise.*.toml",
        "-- **/*.pem",
      ].join("\n"),
    },
  },
];

/** patch 真源：生成物是包根那份 `cordis.patch.yml`，build 时由插件重写。 */
export const patch: PatchBundleOptions = {
  source: "bundles/sandbox-profile/tsdown.config.ts",
  from: import.meta.url,
  rows: () => ROWS,
};

/** 渲染生成物文本（测试拿它与入库那份比对）。 */
export const render = (): string => renderPatch(patch);

export default defineConfig(async () => {
  const base = await defineCordisPluginConfig();
  const plugins = Array.isArray(base.plugins)
    ? [...base.plugins, bundlePatch(patch)]
    : [bundlePatch(patch)];
  return { ...base, plugins };
});
