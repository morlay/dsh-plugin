import { defineConfig } from "tsdown";
import { cordisPlugin } from "@local/tsdown-plugin-cordis";

export default defineConfig({
  entry: {
    plan: "./src/plan.ts",
    testing: "./src/testing.ts",
  },
  plugins: [cordisPlugin({
  client: {
    name: "@morlay/ui-conversation-message-actions",
    entry: "./src/client/index.ts",
  },
  })],
});
