# 如何写（devkit 的工具链）

本层（`devpackages/devkit/`）的规范：它服务两条线（开发线与发布线），改任何一处先认线；`exports` 与内联面的约定也在这里。门面与用法见 [`README.md`](../../README.md)。

## 两条线：开发线与发布线

`devkit` 服务两条互不相同的链，**改任何一处先认线**——两条线的语义相反，串线不会立刻报错，只会静默产出坏产物。

|               | 开发线                                                                                                                                                     | 发布线                                                                                                                                                                                |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 消费什么      | `vendor/**` 上游**源码**（`exports` 指 `src`）                                                                                                             | registry 官方包的 `lib/`                                                                                                                                                              |
| 转译          | `@oxc-node/core/register`（工作区只此一处）：`pnpm-workspace.yaml` 的 `nodeOptions` 覆盖 pnpm 起的进程，vitest worker 与 dev 子进程各自补同一条 `--import` | [`cordis-host.ts`](../../../tsdown-plugin-cordis/src/cordis-host.ts)：tsdown 配置工厂，不覆盖 `transform.decorator`，交给 tsconfig 的 `experimentalDecorators`                                           |
| 装饰器降级    | oxc legacy                                                                                                                                                 | [`standard-decorators.ts`](../../../tsdown-plugin-cordis/src/standard-decorators.ts)（esbuild 标准降级）                                                                              |
| client 半字节 | [`bundleClientFactory`](../../../tsdown-plugin-cordis/src/cordis-client.ts) 现场打包（浏览器平台）                                                         | [`clientEntryPlugin`](../../../tsdown-plugin-cordis/src/cordis-client.ts) 用同一份现场打包的结果换掉 tsdown 的 chunk                                                                  |
| 声明产物      | 与发布线同一条链（转译由上面的 oxc 注册负责）                                                                                                              | 全仓一次类型图（[`dts.ts`](../../../dts-prepare/src/dts.ts) 的 `generateWorkspaceDts`，两个 face 扫到 `target/dts`）→ 每包按路径取 + 合并（`emitDts`，`dtsInput` 模式，不建 program） |

两条线共用 [`css.ts`](../../../tsdown-plugin-cordis/src/css.ts)、[`package-exports.ts`](../../../tsdown-plugin-cordis/src/package-exports.ts)（出口推导与 patch bundle）
与 [`clientBundleSpec`](../../../tsdown-plugin-cordis/src/cordis-client.ts)（解析与外置判据）。装饰器两侧同时成立靠写端 patch 的双协议，
分工与债见 [债务 标准装饰器降级分居两套机制](../../../../.agents/debts/20260923-标准装饰器降级分居两套机制.md)。

**不变量**：`defineCordisPluginConfig` 返回的 tsdown 配置里**不写 `define`**。`clientBundleSpec.define`
（`process.env` / `import.meta` 替成空壳）只属于浏览器产物，而 tsdown 的 `define` 对同一 config 的**所有**
入口生效——host 半（Node / Electron 主进程）拿到它就变成 `{}.DSH_HOME`、`({}).url` 这种运行期必炸的代码
（踩过一次，见 [ADR-开发与桌面消费上游源码面](../../../../.agents/adrs/20261010-开发与桌面消费上游源码面而非lib产物.md)）。
现场打包那条链自己带 define，不经过 tsdown。

## 约定在这里，不在各包

- `exports` / `publishConfig.exports` 由构建从产物推导写回（[`packageExportsHook`](../../../tsdown-plugin-cordis/src/package-exports.ts)），
  client 半的两种形态（装配行 → CJS 工厂；清单标 `dsh.client.inline` 的库 → 普通 ESM）见
  [`clientRowExternals`](../../../tsdown-plugin-cordis/src/cordis-client.ts)；
- `@local/*` 一律内联、不发布；
- 判断这些规则有没有走样的 spec 就在本包 [`src/__tests__/`](../../src/__tests__)（出口推导、client external 判据、
  内联名单与上游 `INLINE_SAFE` 对齐、文档引用与链接可达性）。

规范面（如何写、如何验证）在[仓库规范](../../../../.agents/standards/how-to-write.md)与
[如何验证](../../../../.agents/standards/how-to-verify.md)。
