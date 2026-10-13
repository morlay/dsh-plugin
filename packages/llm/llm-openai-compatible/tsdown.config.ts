import { defineConfig } from "tsdown";
import { cordisPlugin } from "@local/tsdown-plugin-cordis";

export default defineConfig({
  entry: {
    wire: "./src/wire.ts",
  },
  plugins: [cordisPlugin({})],
});
