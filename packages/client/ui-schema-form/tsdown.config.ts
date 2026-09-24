import { defineCordisPluginConfig } from "@local/devkit";

export default defineCordisPluginConfig({
  client: {
    name: "@morlay/dsh-client-ui-schema-form",
    entry: "./src/client/index.ts",
    // 样式层来自我们自己的 css-in-js 原语行（模块表提供）；上游 @deepseek-ai/* 由 @local/devkit
    // 的基线（react / cordis / client-store / ui-slots / ui-primitives）与契约层规则解析。
    externals: [/^@morlay\/dsh-client-ui-/],
  },
});
