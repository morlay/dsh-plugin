import { defineConfig } from "tsdown";
import { cordisPlugin } from "@local/tsdown-plugin-cordis";

export default defineConfig({
  entry: {
    artifact: "./src/artifact.ts",
    deletion: "./src/deletion.ts",
    export: "./src/export.ts",
    gc: "./src/gc.ts",
    import: "./src/import.ts",
    storage: "./src/storage.ts",
    testing: "./src/testing.ts",
    usage: "./src/usage.ts",
  },
  plugins: [cordisPlugin({})],
});
