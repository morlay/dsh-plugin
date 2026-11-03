import { defineConfig } from "tsdown";
import { cordisPlugin } from "@local/tsdown-plugin-cordis";

export default defineConfig({
  // `testing` 是测试辅助（同步句柄 / 临时 PG 库）：依赖 `pg` 与 `node:sqlite` 的能力留在这里，
  // 业务包不必为了测试再依赖驱动。
  entry: { index: "./src/index.ts", testing: "./src/testing.ts" },
  plugins: [cordisPlugin()],
});
