// 配置里的表达式：构建期序列化成 `!!js` 文本，运行期在行 ctx 上求值。
import type { Context as CordisContext } from "@deepseek-ai/cordis";

export const kJsExpr = Symbol("zephyr.js-expr");

export interface JsExpr<T> {
  /** 构建期 YAML 的 `!!js` 文本；由函数体反推。 */
  readonly __jsExpr: string;

  readonly [kJsExpr]: (ctx: CordisContext) => T;
}

function expressionOf(fn: (ctx: CordisContext) => unknown): string {
  const source = fn
    .toString()
    .trim()
    .replace(/\(0,__vite_ssr_import_\d+__\.([A-Za-z_$][\w$]*)\)/gu, "$1")
    .replace(/__vite_ssr_import_\d+__\./gu, "");
  const arrow = source.indexOf("=>");
  if (arrow === -1) return source;
  return source.slice(arrow + 2).trim();
}

/** 配置里的 TS 表达式：mount 前用行 ctx 求值；构建期序列化成 。 */
export function jsExpr<T>(fn: (ctx: CordisContext) => T): T {
  return { __jsExpr: expressionOf(fn), [kJsExpr]: fn } as unknown as T;
}

export function resolveConfigExprs(value: unknown, ctx: CordisContext): unknown {
  if (typeof value === "object" && value !== null && kJsExpr in value) {
    return (value as JsExpr<unknown>)[kJsExpr](ctx);
  }
  if (Array.isArray(value)) return value.map((item) => resolveConfigExprs(item, ctx));
  if (typeof value === "object" && value !== null) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveConfigExprs(item, ctx)]),
    );
  }
  return value;
}
