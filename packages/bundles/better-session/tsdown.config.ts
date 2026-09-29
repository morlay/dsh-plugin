import { defineCordisPluginConfig } from "@local/devkit";
import { bundlePatch, renderPatch, type PatchBundleOptions } from "@local/devkit/patch";
import { defineConfig } from "tsdown";

// 会话面接管的装配行：持久化换 RDB（停官方 `session-persistence-jsonl` / `session-projection-cache` /
// `session-query-sqlite` / `storage-json` 四行，`storage-domain` 的 backend 路由到 `rdb`）、对话外壳换 fork
// （停 `ui-conversation`，插 `ui-conversation-fork` 与 `ui-primitives-fork`）、会话编辑四行、基础面与引用展开（`reference`）。
const ROWS: readonly unknown[] = [
  {
    id: "session-persistence-jsonl",
    disabled: true,
  },
  {
    id: "session-projection-cache",
    disabled: true,
  },
  {
    id: "session-query-sqlite",
    disabled: true,
  },
  {
    id: "storage-json",
    disabled: true,
  },
  {
    id: "storage-domain",
    config: {
      backend: "rdb",
    },
  },
  {
    id: "ui-conversation",
    disabled: true,
  },
  {
    insert: [
      {
        id: "session-branch",
        name: "@morlay/session-branch",
      },
      {
        id: "session-rdb",
        name: "@morlay/session-rdb",
        config: {
          type: "sqlite",
          path: {
            __jsExpr: "dshHomePath('sessions', 'sessions.sqlite')",
          },
        },
      },
      {
        id: "ui-conversation-message-actions",
        name: "@morlay/ui-conversation-message-actions",
      },
      {
        id: "ui-conversation-fork",
        name: "@morlay/dsh-client-ui-conversation",
      },
      {
        id: "ui-primitives-fork",
        name: "@morlay/dsh-client-ui-primitives",
      },
      {
        id: "ui-conversation-manager",
        name: "@morlay/ui-conversation-manager",
      },
      {
        id: "reference",
        name: "@morlay/dsh-reference",
      },
    ],
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
