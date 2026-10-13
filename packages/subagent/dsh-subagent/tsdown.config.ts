import { defineConfig } from "tsdown";
import { cordisPlugin, standardDecoratorsPlugin } from "@local/tsdown-plugin-cordis";

// 能力包：`rows` 出口发布装配数据（行清单），行本身由部署那层装（`packages/bundles/*` 引用它渲染 patch）。
//
// 本包接管的上游源码带**标准（TC39）装饰器**（`@Remote('prompt')`），oxc / rolldown 不降级——产物会
// 带着 `@Remote(...)` 出厂，部署形态加载 `dist` 时直接语法错（`subagents` 服务因此没人注册）。
// 预转换的实现在本插件包，范围与理由见 `../../../.agents/debts/20260923-标准装饰器降级分居两套机制.md`。
export default defineConfig({
  entry: { rows: "./src/rows.ts" },
  plugins: [cordisPlugin(), standardDecoratorsPlugin()],
});
