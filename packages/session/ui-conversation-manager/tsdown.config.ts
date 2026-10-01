import { defineCordisPluginConfig } from "@local/devkit";

export default defineCordisPluginConfig({
  client: {
    name: "@morlay/ui-conversation-manager",
    entry: "./src/client/index.ts",
    // 样式来自 @morlay/dsh-client-ui-primitives：它随本包内联（清单里标了 `dsh.client.inline`），
    // 其余 @deepseek-ai/* 按 @local/devkit 的基线/契约层规则解析。
  },
});
