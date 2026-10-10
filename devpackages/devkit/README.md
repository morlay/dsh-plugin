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

出口：`.`（构建预设与 client 规则）、`./patch`（bundle patch）、`./ts-loader`（开发线 TS loader）、
`./tsconfig.json`（共享 TS 配置）。

## 两条线：开发线与发布线

同一个包服务两条互不相同的链，**改任何一处先认线**——两条线的语义相反，串线不会立刻报错，只会静默产出坏产物。

| | 开发线 | 发布线 |
| --- | --- | --- |
| 消费什么 | `vendor/**` 上游**源码**（`exports` 指 `src`） | registry 官方包的 `lib/` |
| 转译 | [`ts-loader.mjs`](./src/ts-loader.mjs)：oxc 转译 + **legacy** 装饰器降级，经 `NODE_OPTIONS=--import=…` 注入（dev 子进程、vitest worker、`just build`） | [`cordis-host.ts`](./src/cordis-host.ts)：tsdown 配置工厂，`transform.decorator.legacy: false`（**TC39** 语义） |
| 装饰器降级 | oxc legacy | [`standard-decorators.ts`](./src/standard-decorators.ts)（esbuild 标准降级） |
| client 半字节 | [`bundleClientFactory`](./src/cordis-client.ts) 现场打包（浏览器平台） | [`clientEntryPlugin`](./src/cordis-client.ts) 用同一份现场打包的结果换掉 tsdown 的 chunk |
| tsconfig | 本包 [`tsconfig.json`](./tsconfig.json)（`experimentalDecorators: true`） | 仓库根 `tsconfig.json`（rolldown-plugin-dts / tsgo 用它出 dts） |

两条线共用 [`css.ts`](./src/css.ts)、[`package-exports.ts`](./src/package-exports.ts)（出口推导与 patch bundle）
与 [`clientBundleSpec`](./src/cordis-client.ts)（解析与外置判据）。装饰器两侧同时成立靠写端 patch 的双协议，
分工与债见 [债务 标准装饰器降级分居两套机制](../../.agents/debts/20260923-标准装饰器降级分居两套机制.md)。

**不变量**：`defineCordisPluginConfig` 返回的 tsdown 配置里**不写 `define`**。`clientBundleSpec.define`
（`process.env` / `import.meta` 替成空壳）只属于浏览器产物，而 tsdown 的 `define` 对同一 config 的**所有**
入口生效——host 半（Node / Electron 主进程）拿到它就变成 `{}.DSH_HOME`、`({}).url` 这种运行期必炸的代码
（踩过一次，见 [ADR-开发与桌面消费上游源码面](../../.agents/adrs/20261010-开发与桌面消费上游源码面而非lib产物.md)）。
现场打包那条链自己带 define，不经过 tsdown。

## 约定在这里，不在各包

- `exports` / `publishConfig.exports` 由构建从产物推导写回（[`packageExportsHook`](./src/package-exports.ts)），
  client 半的两种形态（装配行 → CJS 工厂；清单标 `dsh.client.inline` 的库 → 普通 ESM）见
  [`clientRowExternals`](./src/cordis-client.ts)；
- `@local/*` 一律内联、不发布；
- 判断这些规则有没有走样的 spec 就在本包 [`src/__tests__/`](./src/__tests__)（出口推导、client external 判据、
  内联名单与上游 `INLINE_SAFE` 对齐、文档引用与链接可达性）。

规范面（如何写、如何验证）在[仓库规范](../../.agents/standards/how-to-write.md)与
[如何验证](../../.agents/standards/how-to-verify.md)。
