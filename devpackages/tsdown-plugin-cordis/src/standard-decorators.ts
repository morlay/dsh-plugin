import type { Plugin } from "rolldown";
import { transform } from "esbuild";

// 装饰器语法的识别：`@Name` 开头的行（标准 TC39 写法；本仓库只用来决定"这份源码要不要过 esbuild"）。
const DECORATOR_SYNTAX = /^\s*@[A-Za-z_$][\w$]*/m;
const TYPESCRIPT_FILE = /\.[cm]?tsx?$/;

export interface StandardDecoratorsOptions {
  // 只处理路径命中的文件；不传即全部（构建期按包的源码树限定范围，见调用点）。
  readonly scope?: RegExp;
  // 是否带出 sourcemap：Vite 侧要，产物构建不要（产物不发布映射）。
  readonly sourcemap?: boolean;
  // Vite 插件的执行时机（rolldown 不认这个字段）：Vite 侧必须 `pre`，否则装饰器可能已被原样透传。
  readonly enforce?: "pre" | "post";
}

// 插件的对外形状：rolldown 那套 + Vite 的 `enforce`（只有 Vite 认，rolldown 侧不读它）。
export type StandardDecoratorsPlugin = Plugin & {
  readonly enforce?: "pre" | "post";
};

// 把标准（TC39）装饰器降级成 Node 能解析的形态：上游 typert 用它标记远程面，而本仓库的薄壳 fork 包
// 走源码入口（tsx / vitest / tsdown 三条链都不经过 tsc，oxc 与 rolldown 也不降级装饰器）。
// 检测到装饰器语法才转，其余源码原样放过；回退条件见 `.agents/debts/20260923-标准装饰器降级分居两套机制.md`。
export function standardDecoratorsPlugin(
  options?: StandardDecoratorsOptions,
): StandardDecoratorsPlugin {
  return {
    name: "dsh-standard-decorators",
    ...(options?.enforce === undefined ? {} : { enforce: options.enforce }),
    async transform(code: string, id: string) {
      const file = id.split("?", 1)[0]!;
      if (!TYPESCRIPT_FILE.test(file)) return;
      if (options?.scope !== undefined && !options.scope.test(file)) return;
      if (!DECORATOR_SYNTAX.test(code)) return;
      const sourcemap = options?.sourcemap === true;
      // 直接用 esbuild 的 API：Vite 8 的 `transformWithEsbuild` 已 deprecated，且 esbuild 只是它的可选 peer。
      const result = await transform(code, {
        loader: file.endsWith("x") ? "tsx" : "ts",
        sourcemap,
        target: "es2024",
        sourcefile: file,
      });
      return { code: result.code, map: sourcemap ? result.map : null };
    },
  };
}
