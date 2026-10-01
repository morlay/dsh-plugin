import { defineCordisPluginConfig } from "@local/devkit";
import { bundlePatch, renderPatch, type PatchBundleOptions } from "@local/devkit/patch";
import { defineConfig } from "tsdown";
import { sandboxRows } from "@morlay/dsh-sandbox-local/rows";

const ROWS: readonly unknown[] = [
  // 基础面（`@morlay/dsh-client-ui-primitives`）随用到它的 client 行内联，不再单独插行。
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
