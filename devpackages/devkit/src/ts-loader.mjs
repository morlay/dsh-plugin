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

globalThis.babelHelpers = {
  decorate(decorators, target, key, desc) {
    let descriptor = desc;
    if (descriptor === null && key !== null) {
      descriptor = Object.getOwnPropertyDescriptor(target, key) ?? null;
    }
    let result = descriptor;
    for (let index = decorators.length - 1; index >= 0; index -= 1) {
      const decorator = decorators[index];
      if (typeof decorator !== "function") continue;
      const next = decorator(target, key, descriptor);
      if (next !== undefined) result = next;
    }
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
