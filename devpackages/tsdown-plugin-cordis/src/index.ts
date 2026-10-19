// cordis 插件包的打包机制：一个 tsdown 配置入口（`defineCordisPluginConfig`）+ 它用到的
// client 入口处理、出口生成、样式处理与声明生成。与 devkit 的其余部分（tsconfig、patch 工具等）分开：
// 前者是"怎么把一个 cordis 插件包打成产物"，后者是"这个仓库的通用开发工具"。
export {
  buildCordisConfig,
  cordisPlugin,
  isInlinedPackage,
  isLocalPackage,
  LOCAL_PACKAGE_PREFIX,
  type CordisPluginOptions,
} from "./cordis-host.ts";
export { clientInjectOf } from "./client-inject.ts";
export {
  packageExportsHook,
  writePackageManifest,
  type PackageExportsOptions,
} from "./package-exports.ts";
export { prebundleDependency, type PrebundledDependency } from "./prebundle.ts";
export { standardDecoratorsPlugin, type StandardDecoratorsOptions } from "./standard-decorators.ts";
export { compileCssModule, compileGlobalCss, compileStyleModule, cssInlinePlugins } from "./css.ts";
export {
  bundleClientFactory,
  bundleClientLibrary,
  clientBundleSpec,
  clientAssetPlugin,
  clientEntryPlugin,
  clientRowExternals,
  ASSET_MIME,
  CLIENT_ENTRY,
  INLINE_SAFE,
  isClientExternal,
} from "./cordis-client.ts";
export type {
  ClientBundleSpec,
  ClientFactoryOptions,
  CordisClientOptions,
} from "./cordis-client.ts";
