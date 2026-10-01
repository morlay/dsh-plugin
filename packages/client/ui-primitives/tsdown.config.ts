import { defineCordisPluginConfig } from "@local/devkit";

// 本包**暂时不装配行**：client 半以普通 ESM 库出口发布（`client: false` 关掉「CJS 单文件工厂」形态），
// 消费行按清单里的 `dsh.client.inline` 把它内联进各自产物（见本包 `.agents/adrs/`）。
// 恢复成装配行的形态：`client: { name, entry }` + 清单写回 `dsh.client.platform` / `inject`。
export default defineCordisPluginConfig({
  entries: { client: "./src/client/index.ts" },
  client: false,
});
