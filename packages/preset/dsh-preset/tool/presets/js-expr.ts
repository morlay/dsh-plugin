/** `!!js` 的值形态：include 的 YAML dialect 把它当表达式节点，Loader 在激活时求值。 */
export interface JsExpr {
  readonly __jsExpr: string;
}

/**
 * 把一段 TS 表达式内联进产物：传一个**无参函数**，取它的函数体，于是表达式是编译器检查过的代码，
 * 而不是手拼的字符串（`process.platform` 这类运行期判断必须留给运行期——产物在构建机上生成）。
 */
export function jsExpr(body: () => unknown): JsExpr {
  return {
    __jsExpr: String(body)
      .replace(/^\(\)\s*=>\s*/, "")
      .replace(/;\s*$/, ""),
  };
}
