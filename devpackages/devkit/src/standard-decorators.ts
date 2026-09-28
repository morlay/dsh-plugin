import type { Plugin } from "rolldown";
import { transformWithEsbuild } from "vite";

// 装饰器语法的识别：`@Name` 开头的行（标准 TC39 写法；本仓库只用来决定"这份源码要不要过 esbuild"）。
const DECORATOR_SYNTAX = /^\s*@[A-Za-z_$][\w$]*/m;
const TYPESCRIPT_FILE = /\.[cm]?tsx?$/;

export interface StandardDecoratorsOptions {
  /** 只处理路径命中的文件；不传即全部（构建期按包的源码树限定范围，见调用点）。 */
  readonly scope?: RegExp;
  /** 是否带出 sourcemap：Vite 侧要，产物构建不要（产物不发布映射）。 */
  readonly sourcemap?: boolean;
  /**
   * Vite 插件的执行时机。rolldown 不认这个字段，所以只在需要时写进插件对象；
   * Vite 侧必须 `pre`——默认时机在别的转换之后，那时装饰器可能已被原样透传。
   */
  readonly enforce?: "pre" | "post";
}

/**
 * 插件的对外形状：rolldown 的那套 + Vite 的 `enforce`。两边的 `plugins` 都收这个对象；
 * `enforce` 只有 Vite 认，rolldown 侧不会读到它。
 */
export type StandardDecoratorsPlugin = Plugin & {
  readonly enforce?: "pre" | "post";
};

/**
 * 把**标准（TC39）装饰器**降级成 Node 能解析的形态。
 *
 * 上游 typert 用它标记远程面（`@Remote('prompt')`），而它们自己的管线里这一步由 tsc 完成；本仓库的薄壳
 * fork 包走源码入口，三条链（tsx 直载、vitest、tsdown）都不经过 tsc，而 oxc / rolldown 不降级装饰器
 * （实测 `transformWithOxc(target: es2018..es2024)` 原样保留）——于是同一份源码在测试与产物里炸。
 * 这里用 esbuild 补上：**检测到装饰器语法才转**，其余源码与文件原样放过。
 *
 * 产物那一侧（tsdown）尤其不能省：部署形态加载的正是 `dist`（profile 把 `@morlay/*` 的 exports 切成
 * `publishConfig` 那套），dev 形态走 tsx 直载源码才显得"没问题"。
 *
 * 回退条件（oxc 支持装饰器降级 / 接入可用的 TS 转译 API / 上游改成命令式调用）见根债务
 * `.agents/debts/20260923-vitest与构建需自行降级标准装饰器.md`。
 */
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
      // esbuild 关掉 sourcemap 时仍回一个空映射对象（`{ mappings: "" }`）；这里按调用方的意思给 `null`。
      const sourcemap = options?.sourcemap === true;
      const result = await transformWithEsbuild(code, file, {
        loader: file.endsWith("x") ? "tsx" : "ts",
        sourcemap,
        target: "es2024",
      });
      return { code: result.code, map: sourcemap ? result.map : null };
    },
  };
}
