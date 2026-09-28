import { defineCordisPluginConfig } from "@local/devkit";
import { defineConfig } from "tsdown";

/**
 * host 半（模式服务 + persona）、client 半（模式 chip / 头部标签 / 字段文案）与 `rows` 出口
 * （装配数据：模式定义与 `preset` 映射）同一次构建。
 */
export default defineConfig(async () => ({
  ...(await defineCordisPluginConfig({
    entries: { rows: "./src/rows.ts" },
    client: {
      name: "@morlay/dsh-session-mode",
      entry: "./src/client/index.ts",
      externals: [/^@morlay\/dsh-client-ui-/],
    },
  })),
}));
