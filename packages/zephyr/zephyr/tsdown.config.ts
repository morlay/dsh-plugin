import { defineConfig } from "tsdown";
import { cordisPlugin } from "@local/tsdown-plugin-cordis";

export default defineConfig({
  entry: {
    index: "./src/index.ts",
    compat: "./src/compat/index.ts",
  },
  plugins: [cordisPlugin()],
});
