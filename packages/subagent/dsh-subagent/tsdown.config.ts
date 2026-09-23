import { defineCordisPluginConfig } from "@local/devkit";
import { transformWithEsbuild } from "vite";

/**
 * 与 devkit 预设同一形状。**必须显式注解**：直接导出推断类型会让 `default` 的类型引用 tsdown / hookable 的
 * 内部声明文件（`Arrayable` / `HookKeys` / `Hookable`），其它包构建时（同一个 TS program）会报
 * `TS2883: The inferred type of 'default' cannot be named without a reference to ...`。
 */
type CordisPluginConfig = Awaited<ReturnType<typeof defineCordisPluginConfig>>;

// 上游 typert 用**标准（TC39）装饰器**标记远程面（`@Remote('prompt')`）。rolldown/oxc 不降级装饰器
// （实测 target es2024 下原样保留），而 Node 运行期不认这种语法（`new Script` 报 SyntaxError）——
// 上游管线里这步由 tsc 完成，这里在打包前用 esbuild 补上。检测语法后再转换，其余文件不动。
// 背景与回退条件见根债务 `.agents/debts/20260923-vitest与构建需自行降级标准装饰器.md`。
const DECORATOR_SYNTAX = /^\s*@[A-Za-z_$][\w$]*/m;

function standardDecorators() {
  return {
    name: "dsh-subagent-standard-decorators",
    async transform(code: string, id: string) {
      const file = id.split("?", 1)[0]!;
      if (!/\.[cm]?tsx?$/.test(file) || !DECORATOR_SYNTAX.test(code)) return;
      const result = await transformWithEsbuild(code, file, {
        loader: file.endsWith("x") ? "tsx" : "ts",
        sourcemap: false,
        target: "es2024",
      });
      return { code: result.code, map: null };
    },
  };
}

export default (async (): Promise<CordisPluginConfig> => {
  const config = await defineCordisPluginConfig();
  // devkit 的 host 预设给数组（本包没有 client 入口，不会是 client 预设的其它形态）。
  const inherited = Array.isArray(config.plugins) ? config.plugins : [];
  return { ...config, plugins: [...inherited, standardDecorators()] };
})();
