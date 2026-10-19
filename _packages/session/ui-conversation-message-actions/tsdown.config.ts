import { defineConfig } from "tsdown";
import { cordisPlugin } from "@local/tsdown-plugin-cordis";

export default defineConfig({
  entry: {
    "cordis-register": "./src/cordis-register.ts",
    plan: "./src/plan.ts",
    testing: "./src/testing.ts",
  },
  plugins: [
    cordisPlugin({
      client: {
        name: "@morlay/ui-conversation-message-actions",
        entry: "./src/client/index.ts",
      },
    }),
  ],
});
