import { defineConfig } from "tsdown";
import { cordisPlugin } from "@local/tsdown-plugin-cordis";

// 说明包：包根（`index`）就是工具说明运行时，`rows` 出口发布工具说明那一行
// （`packages/bundles/session-mode-profile` 的 host 平面引用它），`groups` 出口发布组表与
// 工具签名块的渲染（`@morlay/dsh-session-mode` 的 PTC 骨架引用它）。
export default defineConfig({
  entry: {
    index: "./src/index.ts",
    rows: "./src/rows.ts",
    groups: "./src/guidance/groups.ts",
  },
  plugins: [cordisPlugin()],
});
