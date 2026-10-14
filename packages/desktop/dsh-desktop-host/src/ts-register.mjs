/**
 * 让 Node 也能跑 `node_modules` 下的 `.ts`。
 *
 * Node 内建的 type stripping **拒绝对 `node_modules` 里的文件**做剥离
 * （`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`），而 `@oxc-node/core/register` 也**刻意放行**那类文件
 * （它把 Node 判成 `commonjs-typescript` 的 `.ts` 原样交给 Node，好让报错来自 Node 而不是它）。但**转译
 * 本身**当然能做：这里自己注册 hooks（`registerHooks`，同步钩子），对 `.ts` 直接调 `oxc-transform`——
 * 转译器还是 oxc，只是不再经过"给不给 node_modules 转"的那层策略。
 *
 * 为什么不用 `@oxc-node/core`：它的 `OxcTransformer` 没法配 target（`setTsconfigPath()` 要求"第一次
 * transform/resolve 之前"调用，而加载它自己就已经过了那个时机；`cwd` 与环境变量都不决定 target），默认
 * target 低到不支持顶层 await。独立的 `oxc-transform` 可以直接给 `target: "esnext"`。
 *
 * 也为什么不用内建的 `stripTypeScriptTypes`：它只有 `mode: "strip"`（`transform` 已移除），处理不了
 * `enum` / `namespace` / 参数属性这些非可擦除语法。
 *
 * **为什么是 `.mjs` 而不是 `.ts`**：它自己就是"让 Node 能跑 TS"的那一步，写成 TS 就自举了。
 *
 * 用法：随进程启动挂上（壳的入口 `import` 它；宿主用 `--import`），本模块只做注册、没有导出。
 */
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { transformSync } from "oxc-transform";

registerHooks({
  load(url, context, nextLoad) {
    if (!url.startsWith("file:") || !url.endsWith(".ts")) return nextLoad(url, context);
    const path = fileURLToPath(url);
    // oxlint-disable-next-line node/no-sync -- `registerHooks` 的 load 钩子必须同步返回。
    const original = readFileSync(path, "utf8");
    // oxlint-disable-next-line node/no-sync -- 钩子契约要求同步。
    const result = transformSync(path, original, {
      sourcemap: true,
      // `esnext`：保住顶层 await 这些（我们的源码与上游指到 `src` 的包都在用）。
      target: "esnext",
    });
    if (result.errors.length > 0) {
      const detail = result.errors.map((e) => e.message).join("; ");
      // 上游把 import 失败吞成一句 "failed to import"，所以这里直接打到 stderr——否则看不见真正的原因。
      process.stderr.write(`[ts-register] 转译失败 ${path}: ${detail}\n`);
      throw new Error(`ts-register: ${path}: ${detail}`);
    }
    // `map` 可能是字符串，也可能是 sourcemap 对象——两种都要能带上（栈里才指向原文件）。
    const map = result.map === undefined || result.map === null ? undefined : JSON.stringify(result.map);
    return {
      format: "module",
      source:
        map === undefined
          ? result.code
          : `${result.code}\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${Buffer.from(map, "utf8").toString("base64")}`,
      shortCircuit: true,
    };
  },
});
