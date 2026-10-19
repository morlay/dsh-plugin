# 打包形态下让 Node 跑 `node_modules` 里的 `.ts`

**状态**：部分验证通过，接入未成。**触发**：`dshdev desktop bundle` 之后（dev 形态不受影响）。

## 要解决什么

这条链的**壳**（Electron 的 app 目录）与**宿主**（profile 的 `node_modules`）真实路径都在 `node_modules` 下，
而上游包经 `exports` 指到 `src`（TypeScript）。可是——

- Node 内建的 type stripping **拒绝**对 `node_modules` 里的文件做剥离
  （`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`）；
- `@oxc-node/core/register` 也**刻意放行**那类文件（它把 Node 判成 `commonjs-typescript` 的 `.ts` 原样交给
  Node，好让报错来自 Node 而不是它）；
- `node:module` 的 `stripTypeScriptTypes` 只剩 `mode: "strip"`（`transform` 已移除），处理不了 `enum` /
  `namespace` / 参数属性这些非可擦除语法，而 dsh 用装饰器。

于是现状：**装配时转译一遍**（`prepareShell` 用壳自己的构建配置打 `dist/`）。

dev 形态不受影响：工作区里上游包都是**符号链接**，真实路径在 `vendor/` 下，所以 oxc 的 register 够用。

## 已经验证可行的一半

自建 hooks + 直接转译，**确实能**处理 `node_modules` 下的 `.ts`——与 `@oxc-node/core` 的策略无关：

```js
import { registerHooks } from "node:module";
import { transformSync } from "oxc-transform";

registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith(".ts")) return nextLoad(url, context);
    const result = transformSync(fileURLToPath(url), readFileSync(fileURLToPath(url), "utf8"), {
      target: "esnext", // 保住顶层 await
    });
    return { format: "module", source: result.code, shortCircuit: true };
  },
});
```

实测（`node_modules` 下的 fixture）：顶层 await ✔ / `enum` ✔ / 参数属性 ✔ / 标准装饰器 ✔。

两个走过的弯路（都别再用）：

- `OxcTransformer`（`@oxc-node/core`）**没法配 target**：`setTsconfigPath()` 要求"第一次 transform/resolve
  之前"调用，而加载它自己就已经过了那个时机；`cwd` 与环境变量都不决定 target。默认 target 低到不支持顶层
  await。
- 内建 `stripTypeScriptTypes` 只有 `strip`，见上。

## 卡在哪

把它接进宿主（`nodeArgs: ["--import=…/ts-register.mjs"]`）后，profile 的 **67 个插件全部
"failed to import"**——上游只留这一句，**cause 被吞了**。

已确认的一件事：**转译本身没有失败**（`ts-register` 里转译出错会往 stderr 打 `[ts-register] 转译失败 …`，
实测一次都没出现）。所以问题在别处，很可能是：

- `load` 里**硬编码 `format: "module"`**，而上游有些 `.ts` 是 CJS 语义（`require` / `module.exports`）；
- 或者 loader 根本没被宿主那条 `--import` 加载（需要先确认）。

## 下一步

1. 先确认 loader 有没有被宿主加载（在 `ts-register` 顶部往 stderr 打一行即可）；
2. 按源码/包类型判 `format`（别硬编码 `module`）：`.mts` → module、`.cts` → commonjs、`.ts` 看最近
   `package.json` 的 `type`；
3. 通了之后：`prepareShell` 可以退回"只转译 preload"，`exports` 指回 `src`，宿主与壳都直接跑源码。
