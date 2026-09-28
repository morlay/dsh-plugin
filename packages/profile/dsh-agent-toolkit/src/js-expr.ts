/** `!!js` 的值形态：include 的 YAML dialect 把它当表达式节点，Loader 在激活时求值。 */
export interface JsExpr {
  readonly __jsExpr: string;
}

/** 词字符：它的两侧不能不留空格地粘起来（`typeof x` 不是 `typeofx`）。 */
const WORD = /[\w$]/u;

/**
 * 压掉字符串字面量之外的空白，只在**两侧都是词字符**时留一个（`typeof x` 不能粘成 `typeofx`，
 * 而 `a === b` 可以压成 `a===b`）。
 *
 * 为什么非要压：函数体文本取自 `String(body)`，而它由**加载这段代码的那台转换器**给出——`tsdown` 读
 * `tsdown.config.ts` 的 loader 与 vitest 的 vite 转换器对同一个表达式给出的空白不同（`a === "1"` 对
 * `a==="1"`）。产物是要入库、又要与 `render()` 逐字符比对的文件，所以这里收口到一种形态。
 *
 * 只动空白、不补空白：无论输入是松是紧，结果一样（幂等），也就不必赌转换器站哪边。
 */
function compact(expression: string): string {
  let out = "";
  let quote: string | undefined;
  let pendingSpace = false;
  for (const char of expression) {
    if (quote !== undefined) {
      out += char;
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
    } else if (/\s/u.test(char)) {
      pendingSpace = out.length > 0;
      continue;
    }
    if (pendingSpace && WORD.test(out.at(-1) ?? "") && WORD.test(char)) out += " ";
    pendingSpace = false;
    out += char;
  }
  return out;
}

/**
 * 把一段 TS 表达式内联进产物：传一个**无参函数**，取它的函数体，于是表达式是编译器检查过的代码，
 * 而不是手拼的字符串（`process.platform` 这类运行期判断必须留给运行期——产物在构建机上生成）。
 *
 * 函数体写**单行表达式**：多行的那份原样留着（那时压缩会动到换行与注释的位置）。
 */
export function jsExpr(body: () => unknown): JsExpr {
  const text = String(body)
    .replace(/^\(\)\s*=>\s*/, "")
    .replace(/;\s*$/, "");
  return { __jsExpr: text.includes("\n") ? text : compact(text) };
}
