// Node 的 TS loader：用 oxc 转译 + legacy 装饰器降级，取代 tsx。
//
// 为什么是 `.mjs` 而不是 `.ts`：它是 `--import` 的目标，自己必须先能被 Node 加载，不能再依赖一层转译。
//
// 用 `registerHooks`（in-thread、**同步** hooks）而不是 `module.register`（已 deprecated，DEP0205）：
// 因此转译走 `transformSync`，且 hooks 必须同步返回。
//
// `helpers.mode: 'External'`：oxc 的 legacy 产物引用 `babelHelpers.<name>`；Runtime 模式会生成
// `@oxc-project/runtime/...` 导入，而该包在被转译文件（vendor 内）的位置解析不到，所以这里在主线程注入
// 全局 helper（hooks 返回的代码在主线程执行）。语义与 babel/tsc 的 legacy helper 一致。
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { transformSync } from "rolldown/utils";

// `decorate` 按 tsc 的 legacy `__decorate` 语义实现。oxc 的 legacy 降级按**实参个数**分三种调用，
// 个数是协议的一部分，不能按 `undefined` 归一：
//
//   `decorate([decs], Target)`                      类装饰器：装饰器不返回值时也必须返回 Target。
//     上游 `@Inject` 的 legacy 分路正是 `return`，缺这条兜底会让 `X = decorate([…], X)` 把类抹成
//     undefined——`hmr` 行的 `export default Hmr` 因此成了 `{ default: undefined }`，Loader 判成
//     "invalid plugin"，那一行不激活。
//   `decorate([decs], Target, key, void 0)`         字段装饰器：没有现成 descriptor。
//   `decorate([decs], Target.prototype, key, null)` 方法装饰器：descriptor 由被装饰处取。
globalThis.babelHelpers = {
  decorate(decorators, target, ...rest) {
    const arity = 2 + rest.length;
    const [key, desc] = rest;
    let result;
    if (arity < 3) result = target;
    else if (desc === null) result = Object.getOwnPropertyDescriptor(target, key);
    else result = desc;
    for (let index = decorators.length - 1; index >= 0; index -= 1) {
      const decorator = decorators[index];
      if (typeof decorator !== "function") continue;
      let next;
      if (arity < 3) next = decorator(result);
      else if (arity > 3) next = decorator(target, key, result);
      else next = decorator(target, key);
      result = next || result;
    }
    if (arity > 3 && result) Object.defineProperty(target, key, result);
    return result;
  },
};

const TYPESCRIPT = /\.(?:ts|tsx|mts|cts)$/u;

registerHooks({
  load(url, context, nextLoad) {
    // 按 pathname 判断：消费者（tsdown 等）可能给 URL 带 query（缓存破坏），后缀正则不能直接看整个 URL。
    const pathname = url.split("?", 1)[0];
    if (!pathname.startsWith("file:") || !TYPESCRIPT.test(pathname)) return nextLoad(url, context);
    const filename = fileURLToPath(pathname);
    // 装饰器降级用 oxc 自己的变换选项（字段是**单数** `decorator`）：`legacy: true` 即
    // experimentalDecorators 语义。不传 `tsconfig`——上游各包自带的 tsconfig 已被 patch 删除，
    // 而按文件找 tsconfig 也不可靠（实测 `tsconfig: true` 不向上查找）。
    // oxlint-disable-next-line node/no-sync -- registerHooks 的钩子必须同步返回，读文件与转译只能用同步 API
    const result = transformSync(filename, readFileSync(filename, "utf8"), {
      decorator: { legacy: true },
      helpers: { mode: "External" },
    });
    if (result.errors.length > 0) {
      const first = result.errors[0];
      throw new Error(`dsh ts-loader: ${filename} 转译失败: ${String(first?.message ?? first)}`);
    }
    return {
      format: filename.endsWith(".cts") ? "commonjs" : "module",
      source: result.code ?? "",
      shortCircuit: true,
    };
  },
});
