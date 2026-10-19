import { defineConfig } from "tsdown";
import { cordisPlugin } from "@local/tsdown-plugin-cordis";

export default defineConfig({
  entry: {
    "cordis-register": "./src/cordis-register.ts",
  },
  plugins: [
    cordisPlugin({
      client: {
        name: "@morlay/ui-conversation-manager",
        entry: "./src/client/index.ts",
        // 样式来自 @morlay/dsh-client-ui-primitives：它随本包内联——判据是它写在 `dependencies` 里
        // （client 半的 external 名单只认 `peerDependencies`，见 devkit 的 `clientRowExternals`），
        // 其余 @deepseek-ai/* 按 @local/devkit 的基线/契约层规则解析。
      },
    }),
  ],
});
