# @local/devkit

本地私有工具链（不发布、不进发布清单）：仓库各包的 tsdown 配置预设与**构建期机械判据**——host 与 client
两个入口的打包规则（client 走 CJS 单文件工厂、内联库走普通库产物）、bundle patch 的真源与渲染、包出口推导、
CSS 内联与标准装饰器降级。

## 用法

```ts
import { defineCordisPluginConfig } from "@local/devkit";
import { bundlePatch, renderPatch, type PatchBundleOptions } from "@local/devkit/patch";

export default defineCordisPluginConfig({
  entries: { rows: "./src/rows.ts" }, // 额外入口（index / client 按约定探测）
  inline: ["@morlay/dsh-client-ui-primitives"], // 打进产物、不进依赖清单
});
```

出口：`.`（构建预设与 client 规则）、`./patch`（bundle patch）、`./tsconfig.json`（共享 TS 配置）。

## 约定在这里，不在各包

- `exports` / `publishConfig.exports` 由构建从产物推导写回（[`packageExportsHook`](./src/package-exports.ts)），
  client 半的两种形态（装配行 → CJS 工厂；清单标 `dsh.client.inline` 的库 → 普通 ESM）见
  [`clientRowExternals`](./src/cordis-client.ts)；
- `@local/*` 一律内联、不发布；
- 判断这些规则有没有走样的 spec 就在本包 [`src/__tests__/`](./src/__tests__)（出口推导、client external 判据、
  内联名单与上游 `INLINE_SAFE` 对齐、文档引用与链接可达性）。

规范面（如何写、如何验证）在[仓库规范](../../.agents/standards/how-to-write.md)与
[如何验证](../../.agents/standards/how-to-verify.md)。
