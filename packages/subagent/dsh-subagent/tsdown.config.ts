import { defineCordisPluginConfig, standardDecoratorsPlugin } from "@local/devkit";

// 能力包：`rows` 出口发布装配数据（行清单），行本身由部署那层装（`packages/bundles/*` 引用它渲染 patch）。
//
// **必须显式注解**：直接导出推断类型会让 `default` 的类型引用 tsdown / hookable 的内部声明文件，其它包
// 构建时（同一个 TS program）报 `TS2883`。
type CordisPluginConfig = Awaited<ReturnType<typeof defineCordisPluginConfig>>;

// 本包接管的上游源码带**标准（TC39）装饰器**（`@Remote('prompt')`），而 oxc / rolldown 不降级——产物会
// 带着 `@Remote(...)` 出厂，部署形态加载 `dist` 时直接语法错（`subagents` 服务因此没人注册）。预转换的
// 实现在 devkit，范围与理由见 `../../../.agents/debts/20260923-标准装饰器降级分居两套机制.md`。
export default (async (): Promise<CordisPluginConfig> => {
  const config = await defineCordisPluginConfig({
    entries: { rows: "./src/rows.ts" },
  });
  // devkit 的 host 预设给数组（本包没有 client 入口，不会是 client 预设的其它形态）。
  const inherited = Array.isArray(config.plugins) ? config.plugins : [];
  return { ...config, plugins: [...inherited, standardDecoratorsPlugin()] };
})();
