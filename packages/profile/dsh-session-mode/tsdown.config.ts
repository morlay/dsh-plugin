import { defineCordisPluginConfig, standardDecoratorsPlugin } from "@local/devkit";
import { defineConfig } from "tsdown";

// **必须显式注解**：直接导出推断类型会让 `default` 的类型引用 tsdown / hookable 的内部声明文件，其它包
// 构建时（同一个 TS program）报 `TS2883`。
type CordisPluginConfig = Awaited<ReturnType<typeof defineCordisPluginConfig>>;

// host 半（模式服务 + persona + 配置页的目录面）、client 半（模式 chip / 字段文案）与 `rows` 出口
// （装配数据：模式定义与 `preset` 映射）同一次构建。
export default defineConfig(async (): Promise<CordisPluginConfig> => {
  const config = await defineCordisPluginConfig({
    entries: { rows: "./src/rows.ts" },
    client: {
      name: "@morlay/dsh-session-mode",
      entry: "./src/client/index.ts",
    },
  });
  // host 半的目录面带**标准（TC39）装饰器**（`src/catalog.ts` 的 `@Remote('list')`），而 oxc / rolldown
  // 不降级——产物会带着 `@Remote(...)` 出厂，部署形态加载 dist 时直接语法错。预转换的实现在 devkit，
  // 范围与理由见 `../../../.agents/debts/20260923-vitest与构建需自行降级标准装饰器.md`。devkit 的 host
  // 预设给数组（client 入口只体现在这份数组的成员上，不是另一种形态）。
  const inherited = Array.isArray(config.plugins) ? config.plugins : [];
  return { ...config, plugins: [...inherited, standardDecoratorsPlugin()] };
});
