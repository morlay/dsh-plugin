import { defineCordisPluginConfig } from "@local/devkit";
import { bundlePatch, renderPatch, type PatchBundleOptions } from "@local/devkit/patch";
import { defineConfig } from "tsdown";
import { sandboxRows } from "@morlay/dsh-sandbox-local/rows";

const ROWS: readonly unknown[] = [
  // 共享 client 行：本 bundle 的 client 半 inject 它；同 id 重复插入是幂等的（Loader 复用同一 Entry，后者胜）。
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

// patch 真源：生成物是包根那份 `cordis.patch.yml`，build 时由插件重写。
export const patch: PatchBundleOptions = {
  from: import.meta.url,
  rows: () => ROWS,
};

// 渲染生成物文本（测试拿它与入库那份比对）。
export const render = (): Promise<string> => renderPatch(patch);

export default defineConfig(async () => {
  const base = await defineCordisPluginConfig();
  const plugins = Array.isArray(base.plugins)
    ? [...base.plugins, bundlePatch(patch)]
    : [bundlePatch(patch)];
  return { ...base, plugins };
});
