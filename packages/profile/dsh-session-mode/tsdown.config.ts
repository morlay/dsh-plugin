import { defineCordisPluginConfig } from "@local/devkit";
import { defineConfig } from "tsdown";
import { patchHooks } from "./tool/patch.ts";

export default defineConfig(async () => ({
  // host 半（模式服务 + persona + 路由）与 client 半（顶部 chip 与会话头部标签）同一次构建；
  // client 入口由 devkit 按 `src/client/index.ts` 认出来，`@morlay/dsh-client-ui-conversation`
  // 是模块表里的插件（槽位声明来源），必须留在外部。
  ...(await defineCordisPluginConfig({
    client: {
      name: "@morlay/dsh-session-mode",
      entry: "./src/client/index.ts",
      externals: [/^@morlay\/dsh-client-ui-/],
    },
  })),
  hooks: patchHooks(),
}));
