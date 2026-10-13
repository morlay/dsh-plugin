import { defineConfig } from "tsdown";
import { cordisPlugin, standardDecoratorsPlugin } from "@local/tsdown-plugin-cordis";

// host 半（模式服务 + persona + 配置页的目录面）、client 半（模式 chip / 字段文案）与 `rows` 出口
// （装配数据：模式定义与 `preset` 映射）同一次构建。
export default defineConfig({
  entry: { rows: "./src/rows.ts", testing: "./src/testing.ts" },
  plugins: [
    cordisPlugin({
      client: { name: "@morlay/dsh-session-mode", entry: "./src/client/index.ts" },
    }),
    // host 半的目录面带**标准（TC39）装饰器**（`src/catalog.ts` 的 `@Remote('list')`），oxc / rolldown 不降级；
    // 预转换的实现在本插件包，范围与理由见 `../../../.agents/debts/20260923-标准装饰器降级分居两套机制.md`。
    standardDecoratorsPlugin(),
  ],
});
