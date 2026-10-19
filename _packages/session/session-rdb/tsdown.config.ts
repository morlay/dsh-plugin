import { defineConfig } from "tsdown";
import { cordisPlugin } from "@local/tsdown-plugin-cordis";

export default defineConfig({
  entry: {
    "cordis-register": "./src/cordis-register.ts",
    admin: "./src/admin/index.ts",
    branch: "./src/branch/index.ts",
    artifact: "./src/artifact.ts",
    storage: "./src/storage.ts",
    testing: "./src/testing.ts",
  },
  plugins: [cordisPlugin({})],
});
